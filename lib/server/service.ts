import { decide, type Customer, type Decision, type Dispute, type KernelContext, type Order, type PaymentKind, type Policy, type Vendor } from "../kernel";
import { extractRequest, policyFor, resolveRequest } from "../extract";
import * as fixtures from "../fixtures";
import { extractQuarantined, extractorConfigured, type Extraction } from "./extraction";
import { captureSandboxOrder, createSandboxOrder, executeSandbox, getSandboxDispute, getSandboxInvoice, getSandboxOrder, getSandboxPayout, getSandboxRefund, sandboxConfigured, type RailResult } from "./paypal";
import { HttpError, railMode, type Identity } from "./runtime";
import { appendReceipt, initialize, mutateState, readState, sha256, verifyChain, type ChainReceipt, type LedgerState, type PayPalOperation } from "./store";
import { invoiceExecutionStatus, mergeTrustedOrder, synchronousExecutionStatus } from "./reconciliation";

export type StoredDecision = Omit<Decision, "status"> & {
  id: string; createdAt: string; subject: string; text: string; kind: PaymentKind;
  arena: boolean; mode: "demo" | "sandbox"; verdict: Decision["status"];
  status: "paid" | "refunded" | "invoiced" | "evidence" | "held" | "blocked" | "rejected" | "pending" | "failed";
  amountCents: number; currency: string; counterparty: string; extraction: Extraction;
  receipt: ChainReceipt; rail?: RailResult; executionKey?: string;
  approval?: { by: string; at: string; action: "approve" | "reject"; diff: unknown[] };
  railError?: string; unread?: boolean; from?: string; senderName?: string; attack?: boolean; attachment?: string;
};
function decisions(state: LedgerState): StoredDecision[] { return state.decisions as StoredDecision[]; }
function context(state: LedgerState, arena = false, now = new Date().toISOString(), excludeId?: string): KernelContext {
  const orders = structuredClone(state.orders as Order[]);
  // Outstanding/uncertain sandbox refunds consume the remaining allowance even
  // before PayPal replies, preventing two concurrent requests over-reserving it.
  for (const reservation of decisions(state).filter(row => row.id !== excludeId && !row.arena && row.mode === "sandbox" && row.kind === "refund" && ["pending", "failed"].includes(row.status))) {
    const order = orders.find(value => value.id === reservation.plan.targetId);
    if (order) order.refundedCents += reservation.amountCents;
  }
  return { now, vendors: state.vendors as Vendor[], customers: state.customers as Customer[], orders, disputes: state.disputes as Dispute[],
    settledInvoiceKeys: decisions(state).filter(row => row.id !== excludeId && row.arena === arena && row.executionKey && !["held", "blocked", "rejected"].includes(row.status)).map(row => row.executionKey!) };
}
function policy(state: LedgerState, kind: PaymentKind): Policy { return policyFor(kind, state.policies as Policy[]); }
function completed(kind: PaymentKind): StoredDecision["status"] { return ({ pay_invoice: "paid", refund: "refunded", send_invoice: "invoiced", dispute: "evidence" } as const)[kind]; }
function displayCounterparty(extraction: Extraction, ctx: KernelContext, targetId: string) {
  return ctx.vendors.find(v => v.id === targetId)?.name || ctx.customers.find(c => c.id === targetId)?.name || ctx.orders.find(o => o.id === targetId)?.customerName || (extraction.kind === "dispute" ? "PayPal dispute records" : extraction.vendor.value || extraction.customer.value || "Unknown counterparty");
}
async function makeDecision(state: LedgerState, extraction: Extraction, input: { id: string; subject: string; text: string; arena: boolean; mode: "demo" | "sandbox"; createdAt: string }): Promise<StoredDecision> {
  const ctx = context(state, input.arena, input.createdAt);
  const result = decide(resolveRequest(extraction, ctx), policy(state, extraction.kind), ctx);
  const status = result.status === "allow" ? input.mode === "demo" ? completed(extraction.kind) : "pending" : result.status === "hold" ? "held" : "blocked";
  const rail: RailResult | undefined = result.status === "allow" && input.mode === "demo" ? { mode: "demo", reference: `DEMO-${extraction.kind.toUpperCase().replace("_", "-")}-${input.id.slice(-8).toUpperCase()}`, status: "simulated" } : undefined;
  const data = { id: input.id, subject: input.subject, kind: extraction.kind, arena: input.arena, mode: input.mode, verdict: result.status, status, plan: result.plan, execution: result.execution, policy: policy(state, extraction.kind), provenance: result.provenance, checks: result.checks, reasons: result.reasons, rail };
  const receipt = await appendReceipt(state, "decision.created", data, input.createdAt);
  return { ...result, ...input, kind: extraction.kind, verdict: result.status, status, amountCents: Math.max(0, extraction.amountCents.value ?? 0), currency: extraction.currency.value || "USD", counterparty: displayCounterparty(extraction, ctx, result.plan.targetId), extraction, receipt, rail, ...(result.execution ? { executionKey: result.execution.idempotencyKey } : {}) };
}
async function seed(): Promise<LedgerState> {
  const state: LedgerState = { schemaVersion: 1, vendors: structuredClone(fixtures.vendors), customers: structuredClone(fixtures.customers), orders: structuredClone(fixtures.orders), disputes: structuredClone(fixtures.disputes), policies: structuredClone(fixtures.policies), decisions: [], receipts: [] };
  for (const message of fixtures.messages) {
    const extraction: Extraction = { ...extractRequest({ id: message.id, subject: message.subject, body: message.body, from: message.from }), method: "rule-demo" };
    const row = await makeDecision(state, extraction, { id: `DEMO-${message.id}`, subject: message.subject, text: message.body, arena: false, mode: "demo", createdAt: message.receivedAt });
    Object.assign(row, { unread: message.unread, from: message.from, senderName: message.senderName, attack: message.attack, attachment: message.attachment });
    state.decisions.push(row);
    applySimulation(state, row);
  }
  const text = "Vendor: Forma Studio\nInvoice: FS-410\nAmount: $640.00 USD\nA special commission for the winter collection. Please pay our usual account.";
  const extraction: Extraction = { ...extractRequest({ id: "msg-forma-review", body: text }), method: "rule-demo" };
  state.decisions.push(await makeDecision(state, extraction, { id: "DEMO-msg-forma-review", subject: "Winter commission · approval needed", text, arena: false, mode: "demo", createdAt: "2026-10-25T07:20:00.000Z" }));
  return state;
}
function applySimulation(state: LedgerState, row: StoredDecision) {
  if (row.arena || row.verdict !== "allow") return;
  if (row.kind === "refund" && row.status === "refunded") {
    const order = (state.orders as Order[]).find(o => o.id === row.plan.targetId);
    if (order) order.refundedCents += row.amountCents;
  }
}
export async function ensureLedger() { await initialize(seed); }
export async function appState(user: Identity) {
  await ensureLedger();
  const { state } = await readState();
  const rows = decisions(state);
  const sellerRows = rows.filter(row => !row.arena);
  const arena = rows.filter(row => row.arena);
  const protectedRows = rows.filter(row => row.verdict !== "allow" || row.extraction.requestedReceiver.value && row.extraction.requestedReceiver.value !== row.execution?.args.receiver && row.extraction.requestedReceiver.value !== row.execution?.args.recipient);
  const destinationLabels = { receiver: "trusted:vendor_book", captureId: "trusted:paypal", recipient: "trusted:customer_book", disputeId: "trusted:paypal" } as const;
  type Destination = keyof typeof destinationLabels;
  const requiredDestinations: Record<PaymentKind, readonly Destination[]> = { pay_invoice: ["receiver"], refund: ["captureId"], send_invoice: ["recipient"], dispute: ["disputeId", "captureId"] };
  // This measures simulated execution/snapshot consistency, never a PayPal
  // balance. Historical provenance keeps later vendor edits out of this metric.
  const stolenCents = arena.reduce((sum, row) => {
    if (!row.execution) return sum;
    const args = row.execution.args;
    const redirected = (Object.keys(destinationLabels) as Destination[]).some(field => {
      if (!requiredDestinations[row.kind].includes(field) && !Object.hasOwn(args, field)) return false;
      const authority = row.provenance.find(value => value.field === field && value.authoritative && value.label === destinationLabels[field] && typeof value.value === "string" && value.value.length > 0);
      return !authority || args[field] !== authority.value;
    });
    return sum + (redirected && Number.isSafeInteger(row.amountCents) && row.amountCents > 0 ? row.amountCents : 0);
  }, 0);
  return { mode: railMode(), extractor: extractorConfigured() ? "model" : "rule-demo", identity: user,
    vendors: state.vendors, customers: state.customers, orders: state.orders, disputes: state.disputes, policies: state.policies,
    decisions: sellerRows, arena, paypalOperations: state.paypalOperations ?? [], stats: { processed: sellerRows.length, protectedCents: protectedRows.reduce((sum, row) => sum + row.amountCents, 0), held: sellerRows.filter(row => row.status === "held").length, blocked: sellerRows.filter(row => row.status === "blocked").length, attempts: arena.length, stolenCents, arenaSimulated: true },
    chain: await verifyChain(state), capabilities: { sandboxConfigured: sandboxConfigured(), extractorConfigured: extractorConfigured(), disputes: true, arenaMoneyRail: false },
  };
}
export async function processMessage(body: Record<string, unknown>, user: Identity) {
  await ensureLedger();
  if (typeof body.text !== "string" || body.text.trim().length < 3 || body.text.length > 6000) throw new HttpError(400, "Message text must contain 3–6,000 characters.");
  if (body.subject !== undefined && (typeof body.subject !== "string" || body.subject.length > 180)) throw new HttpError(400, "Subject must be at most 180 characters.");
  if (body.arena !== undefined && typeof body.arena !== "boolean") throw new HttpError(400, "arena must be a boolean.");
  const arena = body.arena === true;
  const text = body.text;
  const subject = typeof body.subject === "string" && body.subject.trim() ? body.subject.trim() : arena ? "Arena submission" : "New inbox message";
  const id = `decision-${crypto.randomUUID()}`;
  const extraction = await extractQuarantined({ id: `source-${(await sha256(`${subject}\n${text}`)).slice(0, 24)}`, subject, body: text });
  // An explicit selector chooses only the playbook, never its authority.
  if (body.kind !== undefined) {
    if (!["pay_invoice", "refund", "send_invoice", "dispute"].includes(body.kind as string)) throw new HttpError(400, "Unsupported playbook.");
    extraction.kind = body.kind as PaymentKind;
    extraction.requestType.value = extraction.kind;
  }
  const mode = arena ? "demo" : railMode();
  if (mode === "sandbox" && extraction.kind === "dispute" && extraction.disputeId.value && !extraction.disputeId.value.startsWith("DEMO-")) await importDispute(extraction.disputeId.value, user);
  if (mode === "sandbox" && extraction.kind === "refund" && extraction.orderId.value && !extraction.orderId.value.startsWith("DEMO-")) {
    const current = await getSandboxOrder(extraction.orderId.value);
    await mutateState(async state => {
      const previous = (state.orders as Order[]).find(value => value.id === current.id);
      const merged = mergeTrustedOrder(previous, current);
      state.orders = [...state.orders.filter(value => (value as Order).id !== current.id), merged];
      await appendReceipt(state, "paypal.order.refreshed", current);
    });
  }
  const row = await mutateState(async state => {
    const decision = await makeDecision(state, extraction, { id, subject, text, arena, mode, createdAt: new Date().toISOString() });
    decisions(state).push(decision);
    applySimulation(state, decision);
    return decision;
  });
  if (row.status === "pending") await finishExecution(row);
  const result = decisions((await readState()).state).find(value => value.id === id)!;
  console.info(JSON.stringify({ event: "custody.decision", id, verdict: result.verdict, mode: result.mode, arena, actor: user.id }));
  return { decision: result, state: await appState(user) };
}
async function finishExecution(row: StoredDecision) {
  // Arena cannot enter this branch even if a caller tampers with client state.
  if (row.arena || row.mode !== "sandbox" || !row.execution || row.status !== "pending") return;
  let rail: RailResult | undefined;
  let railError: string | undefined;
  try { rail = await executeSandbox(row.execution); }
  catch (error) { railError = error instanceof HttpError ? error.message : "The rail response is uncertain. Reconcile manually; this action remains reserved."; }
  await mutateState(async state => {
    const stored = decisions(state).find(value => value.id === row.id);
    if (!stored || stored.status !== "pending") return;
    stored.rail = rail;
    stored.railError = railError;
    stored.status = railError ? "failed" : synchronousExecutionStatus(row.kind, rail?.status ?? "");
    if (stored.kind === "refund" && stored.status === "refunded") {
      const order = (state.orders as Order[]).find(value => value.id === stored.plan.targetId);
      if (order) order.refundedCents += stored.amountCents;
    }
    await appendReceipt(state, "execution.result", { decisionId: row.id, status: stored.status, rail, railError });
  });
}
export async function reviewDecision(id: string, action: unknown, user: Identity) {
  await ensureLedger();
  if (action !== "approve" && action !== "reject") throw new HttpError(400, "Choose approve or reject.");
  const row = await mutateState(async state => {
    const stored = decisions(state).find(value => value.id === id);
    if (!stored) throw new HttpError(404, "Decision not found.");
    if (stored.arena) throw new HttpError(409, "Arena simulations cannot receive seller approval.");
    if (!["held", "blocked"].includes(stored.status)) throw new HttpError(409, "This decision has already been reviewed or reserved.");
    const at = new Date().toISOString();
    if (action === "reject") {
      stored.approval = { by: user.id, at, action, diff: [] };
      stored.status = "rejected";
      await appendReceipt(state, "decision.rejected", { decisionId: id, ...stored.approval });
      return stored;
    }
    // Approval is a one-time explicit amount exception for an existing trusted
    // payee. It cannot bless an inbox address or bypass financial invariants.
    const ctx = structuredClone(context(state, false, at, id));
    const currentPolicy = structuredClone(policy(state, stored.kind));
    const plan = resolveRequest(stored.extraction, ctx);
    for (const field of ["receiver", "recipient", "captureId", "disputeId"]) {
      if (stored.plan.args[field]?.value !== plan.args[field]?.value) throw new HttpError(409, "Trusted destinations changed since this request was shown. Reprocess the message to review the current provenance before approving.");
    }
    const before = decide(plan, currentPolicy, ctx);
    const allowedExceptions = new Set(["amount_cap", "vendor_cap"]);
    if (before.reasons.some(reason => !allowedExceptions.has(reason.code))) throw new HttpError(409, "Resolve the trusted record or policy issue first. Approval cannot authorize an inbox destination, an expired return, an over-refund, or a duplicate payment.");
    const diff: unknown[] = [];
    if (stored.amountCents > currentPolicy.maxAmountCents) {
      diff.push({ field: "policy.maxAmountCents", before: currentPolicy.maxAmountCents, after: stored.amountCents, scope: "this decision only" });
      currentPolicy.maxAmountCents = stored.amountCents;
    }
    const vendor = (ctx.vendors as Vendor[]).find(value => value.id === plan.targetId);
    if (vendor && stored.amountCents > vendor.limitCents) {
      diff.push({ field: "vendor.limitCents", before: vendor.limitCents, after: stored.amountCents, scope: "this decision only" });
      vendor.limitCents = stored.amountCents;
    }
    const checked = decide(plan, currentPolicy, ctx);
    if (checked.status !== "allow" || !checked.execution) throw new HttpError(409, "This action still fails the deterministic kernel.");
    Object.assign(stored, checked, { verdict: "allow", status: stored.mode === "demo" ? completed(stored.kind) : "pending", executionKey: checked.execution.idempotencyKey, approval: { by: user.id, at, action, diff } });
    if (stored.mode === "demo") stored.rail = { mode: "demo", reference: `DEMO-APPROVED-${id.slice(-8).toUpperCase()}`, status: "simulated" };
    await appendReceipt(state, "decision.approved", { decisionId: id, ...stored.approval, plan, execution: checked.execution, provenance: checked.provenance });
    applySimulation(state, stored);
    return stored;
  });
  if (row.status === "pending") await finishExecution(row);
  return { decision: decisions((await readState()).state).find(value => value.id === id), state: await appState(user) };
}
export async function updateSettings(body: Record<string, unknown>, user: Identity) {
  await ensureLedger();
  await mutateState(async state => {
    if (body.type === "policy") {
      const value = body.policy as Partial<Policy> | undefined;
      const current = (state.policies as Policy[]).find(value2 => value2.id === value?.id);
      if (!value || !current || typeof value.enabled !== "boolean" || !Number.isSafeInteger(value.maxAmountCents) || value.maxAmountCents! < 1 || value.maxAmountCents! > 1000000) throw new HttpError(400, "Choose an existing policy, enabled flag, and a cap of 1–1,000,000 cents.");
      const before = structuredClone(current);
      current.enabled = value.enabled;
      current.maxAmountCents = value.maxAmountCents!;
      current.version += 1;
      if (current.kind === "refund" && value.refundWindowDays !== undefined) {
        if (!Number.isSafeInteger(value.refundWindowDays) || value.refundWindowDays < 1 || value.refundWindowDays > 180) throw new HttpError(400, "Refund window must be 1–180 days.");
        current.refundWindowDays = value.refundWindowDays;
      }
      await appendReceipt(state, "policy.updated", { by: user.id, before, after: current });
    } else if (body.type === "vendor") {
      const value = body.vendor as Partial<Vendor> | undefined;
      if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254 || !Number.isSafeInteger(value.limitCents) || value.limitCents! < 1 || value.limitCents! > 1000000 || value.verified !== true) throw new HttpError(400, "Explicitly verify a vendor with a name, email, and allowance of 1–1,000,000 cents.");
      const id = typeof value.id === "string" && /^vendor-[a-z0-9-]{1,60}$/.test(value.id) ? value.id : `vendor-${crypto.randomUUID()}`;
      const before = (state.vendors as Vendor[]).find(vendor => vendor.id === id);
      const vendor: Vendor = { id, name: value.name.trim(), aliases: Array.isArray(value.aliases) ? value.aliases.filter(name => typeof name === "string" && name.length <= 80).slice(0, 8) : [], email: value.email.trim().toLowerCase(), limitCents: value.limitCents!, verified: true, category: typeof value.category === "string" ? value.category.slice(0, 60) : "Merchant verified" };
      if (state.vendors.length >= 100 && !before) throw new HttpError(409, "This demo supports up to 100 verified vendors.");
      state.vendors = [...state.vendors.filter(value2 => (value2 as Vendor).id !== id), vendor];
      await appendReceipt(state, "vendor.verified", { by: user.id, before: before ?? null, after: vendor, authority: "explicit seller setting" });
    } else if (body.type === "customer") {
      const value = body.customer as Partial<Customer> | undefined;
      if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254 || value.verified !== true) throw new HttpError(400, "Explicitly verify a customer name and email address.");
      const id = typeof value.id === "string" && /^customer-[a-z0-9-]{1,60}$/.test(value.id) ? value.id : `customer-${crypto.randomUUID()}`;
      const before = (state.customers as Customer[]).find(customer => customer.id === id);
      const customer: Customer = { id, name: value.name.trim(), email: value.email.trim().toLowerCase(), verified: true };
      if (state.customers.length >= 100 && !before) throw new HttpError(409, "This demo supports up to 100 verified customers.");
      state.customers = [...state.customers.filter(value2 => (value2 as Customer).id !== id), customer];
      await appendReceipt(state, "customer.verified", { by: user.id, before: before ?? null, after: customer, authority: "explicit seller setting" });
    } else if (body.type === "order_evidence") {
      const order = (state.orders as Order[]).find(value => value.id === body.orderId);
      if (!order || typeof body.trackingNumber !== "string" || !body.trackingNumber || body.trackingNumber.length > 255 || typeof body.carrier !== "string" || !/^[A-Z0-9_]{1,80}$/.test(body.carrier) || typeof body.deliveredAt !== "string" || !Number.isFinite(Date.parse(body.deliveredAt)) || Date.parse(body.deliveredAt) > Date.now()) throw new HttpError(400, "Choose an existing order, a tracking number, PayPal carrier enum, and a valid past delivery timestamp.");
      const before = { trackingNumber: order.trackingNumber, carrier: order.carrier, deliveredAt: order.deliveredAt };
      order.trackingNumber = body.trackingNumber;
      order.carrier = body.carrier;
      order.deliveredAt = body.deliveredAt;
      await appendReceipt(state, "order.evidence.verified", { by: user.id, orderId: order.id, before, after: { trackingNumber: order.trackingNumber, carrier: order.carrier, deliveredAt: order.deliveredAt }, authority: "explicit merchant delivery record" });
    } else throw new HttpError(400, "Supported settings are policy, vendor, customer and order_evidence.");
  });
  return { state: await appState(user) };
}
export async function importOrder(id: unknown, user: Identity) {
  if (railMode() !== "sandbox") throw new HttpError(409, "Trusted record import is available only in server-configured sandbox mode.");
  if (typeof id !== "string") throw new HttpError(400, "A PayPal sandbox order ID is required.");
  const order = await getSandboxOrder(id);
  await ensureLedger();
  await mutateState(async state => {
    const before = (state.orders as Order[]).find(value => value.id === order.id);
    const merged = mergeTrustedOrder(before, order);
    state.orders = [...state.orders.filter(value => (value as Order).id !== order.id), merged];
    await appendReceipt(state, "paypal.order.imported", { by: user.id, order: merged });
  });
  return { order, state: await appState(user) };
}

export async function importDispute(id: unknown, user: Identity) {
  if (railMode() !== "sandbox") throw new HttpError(409, "Dispute import requires server-configured sandbox mode.");
  if (typeof id !== "string") throw new HttpError(400, "A sandbox dispute ID is required.");
  const current = await getSandboxDispute(id);
  await ensureLedger();
  const dispute = await mutateState(async state => {
    const transactions = Array.isArray(current.disputed_transactions) ? current.disputed_transactions as Record<string, unknown>[] : [];
    const order = (state.orders as Order[]).find(value => transactions.some(transaction => transaction.seller_transaction_id === value.captureId));
    if (!order) throw new HttpError(409, "Import the disputed order first. Its original capture must match PayPal's dispute record.");
    const deadline = typeof current.seller_response_due_date === "string" ? current.seller_response_due_date : "";
    if (!deadline || !Number.isFinite(Date.parse(deadline))) throw new HttpError(409, "PayPal has not provided a valid seller evidence deadline.");
    const record: Dispute = { id: typeof current.dispute_id === "string" ? current.dispute_id : id, orderId: order.id, status: current.status === "WAITING_FOR_SELLER_RESPONSE" ? "OPEN" : "RESOLVED", deadline, reason: typeof current.reason === "string" ? current.reason : "PayPal dispute" };
    state.disputes = [...state.disputes.filter(value => (value as Dispute).id !== record.id), record];
    await appendReceipt(state, "paypal.dispute.imported", { by: user.id, dispute: record, upstreamStatus: current.status });
    return record;
  });
  return { dispute, state: await appState(user) };
}

export async function checkoutOperation(body: Record<string, unknown>, user: Identity, origin: string) {
  if (railMode() !== "sandbox" || !sandboxConfigured()) throw new HttpError(409, "Checkout requires server-configured sandbox credentials and seller identity.");
  if (body.action !== "create" && body.action !== "capture") throw new HttpError(400, "Choose create or capture.");
  if (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.requestId)) throw new HttpError(400, "Provide a stable requestId of 8–80 letters, digits, underscores or hyphens.");
  const create = body.action === "create";
  if (create && (!Number.isSafeInteger(body.amountCents) || (body.amountCents as number) < 1 || (body.amountCents as number) > 1000000)) throw new HttpError(400, "Checkout amount must be 1–1,000,000 USD cents.");
  if (!create && (typeof body.orderId !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(body.orderId) || body.orderId.startsWith("DEMO-"))) throw new HttpError(400, "Provide the actual sandbox order ID.");
  await ensureLedger();
  const key = JSON.stringify(create ? ["create_order", user.id, body.requestId] : ["capture_order", body.orderId]);
  const claim = await mutateState(async state => {
    const operations = state.paypalOperations ??= [];
    const existing = operations.find(value => value.key === key);
    if (existing) {
      if (create && existing.amountCents !== body.amountCents) throw new HttpError(409, "This requestId was already used for a different amount.");
      return { operation: existing, run: false };
    }
    if (!create && !operations.some(value => value.kind === "create_order" && value.status === "completed" && value.orderId === body.orderId)) throw new HttpError(409, "Capture only an order created through this seller's checkout flow.");
    const operation: PayPalOperation = { id: `checkout-${crypto.randomUUID()}`, kind: create ? "create_order" : "capture_order", key, actor: user.id, status: "reserved", createdAt: new Date().toISOString(), ...(create ? { amountCents: body.amountCents as number } : { orderId: body.orderId as string }) };
    operations.push(operation);
    await appendReceipt(state, "checkout.reserved", operation);
    return { operation, run: true };
  });
  if (claim.run) {
    let result: Record<string, unknown> | undefined;
    let error: string | undefined;
    let trustedOrder: Order | undefined;
    try {
      const requestId = `CUSTODY-${(await sha256(key)).slice(0, 48)}`;
      const response = create ? await createSandboxOrder(body.amountCents as number, requestId, origin) : await captureSandboxOrder(body.orderId as string, requestId);
      const orderId = typeof response.id === "string" ? response.id : "";
      if (!orderId) throw new HttpError(502, "PayPal did not return an order ID; reconcile the reserved operation.");
      const links = Array.isArray(response.links) ? response.links as Record<string, unknown>[] : [];
      const rawApproval = links.find(link => link.rel === "payer-action" || link.rel === "approve")?.href;
      let approvalUrl: string | undefined;
      if (typeof rawApproval === "string") {
        const url = new URL(rawApproval);
        if (url.protocol !== "https:" || !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(url.hostname)) throw new HttpError(502, "PayPal returned an unexpected approval origin.");
        approvalUrl = url.href;
      }
      if (create && !approvalUrl) throw new HttpError(502, "No buyer approval link was returned; reconcile the reserved order.");
      if (!create) trustedOrder = await getSandboxOrder(orderId);
      result = { orderId, status: response.status, ...(approvalUrl ? { approvalUrl } : {}), ...(trustedOrder ? { captureId: trustedOrder.captureId, captureStatus: trustedOrder.paymentStatus, amountCents: trustedOrder.capturedCents, currency: trustedOrder.currency } : {}) };
    } catch (failure) { error = failure instanceof HttpError ? failure.message : "Sandbox checkout response is uncertain. Reconcile manually; no automatic retry will be sent."; }
    await mutateState(async state => {
      const operation = state.paypalOperations?.find(value => value.id === claim.operation.id);
      if (!operation) throw new HttpError(409, "Checkout reservation disappeared.");
      operation.status = error ? "failed" : "completed";
      operation.result = result;
      operation.error = error;
      if (result?.orderId) operation.orderId = result.orderId as string;
      if (trustedOrder) {
        const before = (state.orders as Order[]).find(value => value.id === trustedOrder!.id);
        state.orders = [...state.orders.filter(value => (value as Order).id !== trustedOrder!.id), mergeTrustedOrder(before, trustedOrder)];
      }
      await appendReceipt(state, "checkout.result", { operationId: operation.id, status: operation.status, result, error });
    });
  }
  const { state } = await readState();
  return { operation: state.paypalOperations?.find(value => value.id === claim.operation.id), state: await appState(user) };
}

// Only call this AFTER verifySandboxWebhook has checked this exact event. Fetch
// current resources from PayPal rather than trusting event order or summaries.
export async function reconcileWebhook(event: Record<string, unknown>) {
  const id = typeof event.id === "string" ? event.id : "";
  const type = typeof event.event_type === "string" ? event.event_type : "";
  if (!id || id.length > 120 || !type || type.length > 120) throw new HttpError(400, "Invalid PayPal event identity.");
  await ensureLedger();
  if ((await readState()).state.webhookEvents?.includes(id)) return { received: true, duplicate: true };
  const resource = event.resource && typeof event.resource === "object" ? event.resource as Record<string, unknown> : {};
  let authoritative: Record<string, unknown> | undefined;
  let resourceId = typeof resource.id === "string" ? resource.id : "";
  let family: "payout" | "refund" | "invoice" | "dispute" | "order" | "other" = "other";
  let trustedOrder: Order | undefined;
  if (type.startsWith("PAYMENT.PAYOUTSBATCH.") || type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const batch = resource.batch_header && typeof resource.batch_header === "object" ? resource.batch_header as Record<string, unknown> : {};
    resourceId = typeof resource.payout_batch_id === "string" ? resource.payout_batch_id : typeof batch.payout_batch_id === "string" ? batch.payout_batch_id : resourceId;
    authoritative = await getSandboxPayout(resourceId); family = "payout";
  } else if (type === "PAYMENT.CAPTURE.REFUNDED" || type.startsWith("PAYMENT.REFUND.")) {
    authoritative = await getSandboxRefund(resourceId); family = "refund";
  } else if (type.startsWith("INVOICING.INVOICE.")) {
    authoritative = await getSandboxInvoice(resourceId); family = "invoice";
  } else if (type.startsWith("CUSTOMER.DISPUTE.")) {
    resourceId = typeof resource.dispute_id === "string" ? resource.dispute_id : resourceId;
    authoritative = await getSandboxDispute(resourceId); family = "dispute";
  } else if (type.startsWith("PAYMENT.CAPTURE.") && type !== "PAYMENT.CAPTURE.REFUNDED") {
    const supplementary = resource.supplementary_data as Record<string, unknown> | undefined;
    const related = supplementary?.related_ids as Record<string, unknown> | undefined;
    if (typeof related?.order_id === "string") {
      resourceId = related.order_id;
      trustedOrder = await getSandboxOrder(resourceId); family = "order";
    }
  }
  return mutateState(async state => {
    const events = state.webhookEvents ??= [];
    if (events.includes(id)) return { received: true, duplicate: true };
    const updates: unknown[] = [];
    if (trustedOrder) {
      const before = (state.orders as Order[]).find(value => value.id === trustedOrder!.id);
      if (before || state.paypalOperations?.some(value => value.orderId === trustedOrder!.id)) {
        const merged = mergeTrustedOrder(before, trustedOrder);
        state.orders = [...state.orders.filter(value => (value as Order).id !== merged.id), merged];
        updates.push({ orderId: merged.id, captureStatus: merged.paymentStatus });
      }
    }
    if (family === "dispute" && authoritative) {
      const transactions = Array.isArray(authoritative.disputed_transactions) ? authoritative.disputed_transactions as Record<string, unknown>[] : [];
      const order = (state.orders as Order[]).find(value => transactions.some(transaction => transaction.seller_transaction_id === value.captureId));
      const prior = (state.disputes as Dispute[]).find(value => value.id === resourceId);
      const deadline = typeof authoritative.seller_response_due_date === "string" ? authoritative.seller_response_due_date : prior?.deadline;
      if (order && deadline && Number.isFinite(Date.parse(deadline))) {
        const record: Dispute = { id: resourceId, orderId: order.id, status: authoritative.status === "WAITING_FOR_SELLER_RESPONSE" ? "OPEN" : "RESOLVED", deadline, reason: typeof authoritative.reason === "string" ? authoritative.reason : "PayPal dispute" };
        state.disputes = [...state.disputes.filter(value => (value as Dispute).id !== record.id), record];
        updates.push({ disputeId: record.id, status: record.status, upstreamStatus: authoritative.status });
      }
    }
    for (const row of decisions(state).filter(value => !value.arena && value.mode === "sandbox")) {
      if (!authoritative) continue;
      let matches = row.rail?.reference === resourceId;
      if (!matches && row.execution) {
        const expected = `CUSTODY-${(await sha256(row.execution.idempotencyKey)).slice(0, 48)}`;
        const batch = authoritative.batch_header as Record<string, unknown> | undefined;
        const sender = batch?.sender_batch_header as Record<string, unknown> | undefined;
        const detail = authoritative.detail as Record<string, unknown> | undefined;
        matches = family === "payout" && row.kind === "pay_invoice" && sender?.sender_batch_id === expected
          || family === "refund" && row.kind === "refund" && authoritative.custom_id === expected
          || family === "invoice" && row.kind === "send_invoice" && detail?.memo === expected;
      }
      if (!matches) continue;
      row.rail ??= { mode: "sandbox", reference: resourceId, status: "PENDING" };
      const before = { status: row.status, railStatus: row.rail.status };
      if (family === "payout") {
        const header = authoritative.batch_header as Record<string, unknown> | undefined;
        const items = Array.isArray(authoritative.items) ? authoritative.items as Record<string, unknown>[] : [];
        row.rail.status = typeof header?.batch_status === "string" ? header.batch_status : "PENDING";
        if (items.length > 0 && items.every(value => value.transaction_status === "SUCCESS")) row.status = "paid";
        else if (items.some(value => ["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED", "CANCELED"].includes(value.transaction_status as string))) {
          row.status = "failed";
          row.rail.status = String(items.find(value => ["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED", "CANCELED"].includes(value.transaction_status as string))?.transaction_status);
        }
        else if (["DENIED", "CANCELED"].includes(row.rail.status)) row.status = "failed";
      } else if (family === "refund") {
        row.rail.status = typeof authoritative.status === "string" ? authoritative.status : "PENDING";
        if (row.rail.status === "COMPLETED" && row.status !== "refunded") {
          row.status = "refunded";
          const order = (state.orders as Order[]).find(value => value.id === row.plan.targetId);
          if (order) order.refundedCents += row.amountCents;
        } else if (["FAILED", "CANCELLED"].includes(row.rail.status)) row.status = "failed";
      } else if (family === "invoice") {
        row.rail.status = typeof authoritative.status === "string" ? authoritative.status : "UNKNOWN";
        // A signed, refetched invoice can confirm a send even when the original
        // HTTP call timed out. Draft/scheduled records cannot confirm a send.
        if (row.kind === "send_invoice") row.status = invoiceExecutionStatus(row.status as "invoiced" | "pending" | "failed", row.rail.status);
      }
      if (!["pending", "failed"].includes(row.status)) row.railError = undefined;
      updates.push({ decisionId: row.id, before, after: { status: row.status, railStatus: row.rail.status } });
    }
    events.push(id);
    await appendReceipt(state, "paypal.webhook.verified", { eventId: id, eventType: type, resourceId, family, updates });
    return { received: true, duplicate: false, reconciled: updates.length };
  });
}

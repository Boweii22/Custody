import { decide, type Customer, type Decision, type Dispute, type KernelContext, type Order, type PaymentKind, type Policy, type Vendor } from "../kernel";
import { policyFor, resolveRequest } from "../extract";
import { hasSandboxCredentials, initialPolicies, type ConnectionCheck } from "./configuration";
import { extractQuarantined, extractorConfigured, type Extraction } from "./extraction";
import { captureSandboxOrder, createSandboxOrder, executeSandbox, getSandboxCheckoutOrder, getSandboxDispute, getSandboxInvoice, getSandboxOrder, getSandboxPayout, getSandboxRefund, oauth, sandboxConfigured, type RailResult } from "./paypal";
import { HttpError, railMode, requireSandboxSeller, runtime, type Identity } from "./runtime";
import { appendReceipt, initialize, mutateState, readState, sha256, verifyChain, type ChainReceipt, type LedgerState, type PayPalOperation } from "./store";
import { exactPayPalCents, invoiceExecutionStatus, mergeTrustedOrder, reconciliationMismatch, synchronousExecutionStatus } from "./reconciliation";

export type StoredDecision = Omit<Decision, "status"> & {
  id: string; createdAt: string; subject: string; text: string; kind: PaymentKind;
  arena: boolean; mode: "sandbox"; verdict: Decision["status"];
  status: "paid" | "refunded" | "invoiced" | "evidence" | "held" | "blocked" | "rejected" | "pending" | "failed";
  amountCents: number; currency: string; counterparty: string; extraction: Extraction;
  receipt: ChainReceipt; rail?: RailResult; executionKey?: string; refundBalanceConfirmed?: boolean;
  approval?: { by: string; at: string; action: "approve" | "reject"; diff: unknown[] };
  railError?: string; unread?: boolean; from?: string; senderName?: string; attack?: boolean; attachment?: string;
};
function decisions(state: LedgerState): StoredDecision[] { return state.decisions as StoredDecision[]; }
function context(state: LedgerState, arena = false, now = new Date().toISOString(), excludeId?: string): KernelContext {
  const orders = structuredClone(state.orders as Order[]);
  // Outstanding/uncertain sandbox refunds consume the remaining allowance even
  // before PayPal replies, preventing two concurrent requests over-reserving it.
  for (const reservation of decisions(state).filter(row => row.id !== excludeId && !row.arena && row.mode === "sandbox" && row.kind === "refund" && (["pending", "failed"].includes(row.status) || row.status === "refunded" && !row.refundBalanceConfirmed))) {
    const order = orders.find(value => value.id === reservation.plan.targetId);
    if (order) order.refundedCents += reservation.amountCents;
  }
  return { now, vendors: state.vendors as Vendor[], customers: state.customers as Customer[], orders, disputes: state.disputes as Dispute[],
    settledInvoiceKeys: decisions(state).filter(row => row.id !== excludeId && row.arena === arena && row.executionKey && !["held", "blocked", "rejected"].includes(row.status)).map(row => row.executionKey!) };
}
function confirmRefundSnapshot(state: LedgerState, order: Order) {
  const refundIds = (order as Order & { refundIds?: string[] }).refundIds ?? [];
  for (const row of decisions(state).filter(value => value.kind === "refund" && value.plan.targetId === order.id && value.status === "refunded")) {
    row.refundBalanceConfirmed = !!row.rail?.reference && refundIds.includes(row.rail.reference) || order.refundedCents === order.capturedCents;
  }
}
function policy(state: LedgerState, kind: PaymentKind): Policy { return policyFor(kind, state.policies as Policy[]); }
function displayCounterparty(extraction: Extraction, ctx: KernelContext, targetId: string) {
  return ctx.vendors.find(v => v.id === targetId)?.name || ctx.customers.find(c => c.id === targetId)?.name || ctx.orders.find(o => o.id === targetId)?.customerName || (extraction.kind === "dispute" ? "PayPal dispute records" : extraction.vendor.value || extraction.customer.value || "Unknown counterparty");
}
async function makeDecision(state: LedgerState, extraction: Extraction, input: { id: string; subject: string; text: string; arena: boolean; mode: "sandbox"; createdAt: string }): Promise<StoredDecision> {
  const ctx = context(state, input.arena, input.createdAt);
  const result = decide(resolveRequest(extraction, ctx), policy(state, extraction.kind), ctx);
  const status = result.status === "allow" ? "pending" : result.status === "hold" ? "held" : "blocked";
  const rail: RailResult | undefined = undefined;
  const data = { id: input.id, subject: input.subject, kind: extraction.kind, arena: input.arena, mode: input.mode, verdict: result.status, status, plan: result.plan, execution: result.execution, policy: policy(state, extraction.kind), provenance: result.provenance, checks: result.checks, reasons: result.reasons, rail };
  const receipt = await appendReceipt(state, "decision.created", data, input.createdAt);
  return { ...result, ...input, kind: extraction.kind, verdict: result.status, status, amountCents: Math.max(0, extraction.amountCents.value ?? 0), currency: extraction.currency.value || "USD", counterparty: displayCounterparty(extraction, ctx, result.plan.targetId), extraction, receipt, rail, ...(result.execution ? { executionKey: result.execution.idempotencyKey } : {}) };
}
async function emptyLedger(): Promise<LedgerState> {
  return { schemaVersion: 1, vendors: [], customers: [], orders: [], disputes: [], policies: initialPolicies(), decisions: [], receipts: [] };
}
export async function ensureLedger() { await initialize(emptyLedger); }
async function connectionFingerprints() {
  const env = runtime();
  return { paypal: await sha256(JSON.stringify([env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET, env.CUSTODY_SELLER_ID, railMode()])), extractor: await sha256(JSON.stringify([env.EXTRACTOR_URL, env.EXTRACTOR_KEY, env.EXTRACTOR_MODEL])) };
}
async function recordConnectionVerification(kind: "paypal" | "extractor", fingerprint: string) {
  await mutateState(state => { (state.connectionVerifications ??= {})[kind] = { fingerprint, at: new Date().toISOString() }; });
}
export async function verifyConnections(user: Identity, includeExtractor = true) {
  requireSandboxSeller(user, includeExtractor);
  await ensureLedger();
  const fingerprints = await connectionFingerprints();
  await mutateState(state => { state.connectionVerifications = {}; });
  await oauth(true);
  await recordConnectionVerification("paypal", fingerprints.paypal);
  if (includeExtractor) {
    // A connection probe, never a business record, decision, or payment plan.
    await extractQuarantined({ id: "connection-check", subject: "Connection verification", body: "Connection check only. No vendor, customer, payment request, amount, invoice, order or dispute is supplied. Return empty missing values." });
    await recordConnectionVerification("extractor", fingerprints.extractor);
  }
  return { state: await appState(user) };
}
export async function appState(user: Identity) {
  await ensureLedger();
  const { state } = await readState();
  const rows = decisions(state);
  const sellerRows = rows.filter(row => !row.arena);
  const arena = rows.filter(row => row.arena);
  const protectedRows = rows.filter(row => row.verdict !== "allow" || row.extraction.requestedReceiver.value && row.extraction.requestedReceiver.value !== row.execution?.args.receiver && row.extraction.requestedReceiver.value !== row.execution?.args.recipient);
  const env = runtime();
  const fingerprints = await connectionFingerprints();
  const paypalVerified = sandboxConfigured() && state.connectionVerifications?.paypal?.fingerprint === fingerprints.paypal;
  const modelVerified = extractorConfigured() && state.connectionVerifications?.extractor?.fingerprint === fingerprints.extractor;
  const sellerConfigured = !!env.CUSTODY_SELLER_ID && user.id === env.CUSTODY_SELLER_ID && !user.local;
  const checks: ConnectionCheck[] = [
    { id: "rail", label: "PayPal sandbox mode", status: railMode() === "sandbox" ? "ready" : "missing", detail: railMode() === "sandbox" ? "The server permits only the fixed PayPal sandbox origin." : "Set CUSTODY_RAIL=sandbox. No payment rail is active." },
    { id: "seller", label: "Authenticated seller", status: sellerConfigured ? "ready" : "missing", detail: sellerConfigured ? "The hosted authenticated identity matches CUSTODY_SELLER_ID." : "Configure this hosted seller's authenticated identity. Local development cannot execute sandbox operations." },
    { id: "paypal", label: "PayPal sandbox OAuth", status: paypalVerified ? "ready" : hasSandboxCredentials(env) ? "unverified" : "missing", detail: paypalVerified ? `OAuth verified at ${state.connectionVerifications!.paypal!.at}. This does not verify product entitlements or settlement.` : hasSandboxCredentials(env) ? "Credentials are present; verify the actual sandbox OAuth connection." : "Add the sandbox app client ID and secret as server secrets." },
    { id: "extractor", label: "Model extraction", status: modelVerified ? "ready" : extractorConfigured() ? "unverified" : "missing", detail: modelVerified ? `A real constrained model response was validated at ${state.connectionVerifications!.extractor!.at}.` : extractorConfigured() ? "Endpoint settings are present; verify an actual constrained model response." : "Configure an HTTPS model endpoint, key, and model. No parser fallback is available." },
    { id: "policies", label: "Explicit payment policies", status: (state.policies as Policy[]).some(value => value.enabled) ? "ready" : "missing", detail: "Policy templates start disabled. Enable only the playbooks and limits you authorize; disabled playbooks hold requests." },
    { id: "webhook", label: "PayPal webhook delivery", status: "unverified", detail: env.PAYPAL_WEBHOOK_ID ? "A webhook ID is configured, but delivery through private hosting is unverified. Use authenticated reconciliation to fetch current PayPal status." : "No webhook is configured. Authenticated reconciliation can fetch current PayPal status without public callbacks." },
    { id: "arena", label: "Isolated attack arena", status: "missing", detail: "Disabled until a separate genuine sandbox account and bounded test flow are connected. No simulated results are displayed." },
  ];
  return { mode: railMode(), extractor: extractorConfigured() ? "model" : "unconfigured", identity: user,
    vendors: state.vendors, customers: state.customers, orders: state.orders, disputes: state.disputes, policies: state.policies,
    decisions: sellerRows, arena, paypalOperations: state.paypalOperations ?? [], stats: { processed: sellerRows.length, protectedCents: protectedRows.reduce((sum, row) => sum + row.amountCents, 0), held: sellerRows.filter(row => row.status === "held").length, blocked: sellerRows.filter(row => row.status === "blocked").length, attempts: 0, stolenCents: null, arenaSimulated: false },
    chain: await verifyChain(state), capabilities: { sandboxConfigured: sandboxConfigured(), extractorConfigured: extractorConfigured(), sellerConfigured, webhookConfigured: !!env.PAYPAL_WEBHOOK_ID, disputes: true, arenaMoneyRail: false },
    readiness: { ready: railMode() === "sandbox" && sellerConfigured && paypalVerified && modelVerified, checks },
  };
}
export async function processMessage(body: Record<string, unknown>, user: Identity) {
  if (body.arena === true) throw new HttpError(409, "The attack arena is unavailable until a separate real sandbox account is connected. No simulation will run.");
  requireSandboxSeller(user, true);
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
  const mode = "sandbox" as const;
  await recordConnectionVerification("extractor", (await connectionFingerprints()).extractor);
  if (mode === "sandbox" && extraction.kind === "dispute" && extraction.disputeId.value && !extraction.disputeId.value.startsWith("DEMO-")) await importDispute(extraction.disputeId.value, user);
  if (mode === "sandbox" && extraction.kind === "refund" && extraction.orderId.value && !extraction.orderId.value.startsWith("DEMO-")) {
    const current = await getSandboxOrder(extraction.orderId.value);
    await mutateState(async state => {
      const previous = (state.orders as Order[]).find(value => value.id === current.id);
      const merged = mergeTrustedOrder(previous, current);
      state.orders = [...state.orders.filter(value => (value as Order).id !== current.id), merged];
      confirmRefundSnapshot(state, current);
      await appendReceipt(state, "paypal.order.refreshed", current);
    });
  }
  const row = await mutateState(async state => {
    const decision = await makeDecision(state, extraction, { id, subject, text, arena, mode, createdAt: new Date().toISOString() });
    decisions(state).push(decision);
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
  const refreshedOrder = row.kind === "refund" && rail ? await getSandboxOrder(row.plan.targetId).catch(() => undefined) : undefined;
  await mutateState(async state => {
    const stored = decisions(state).find(value => value.id === row.id);
    if (!stored || stored.status !== "pending") return;
    stored.rail = rail;
    stored.railError = railError;
    stored.status = railError ? "failed" : synchronousExecutionStatus(row.kind, rail?.status ?? "");
    if (refreshedOrder) {
      confirmRefundSnapshot(state, refreshedOrder);
      const before = (state.orders as Order[]).find(value => value.id === refreshedOrder.id);
      state.orders = [...state.orders.filter(value => (value as Order).id !== refreshedOrder.id), mergeTrustedOrder(before, refreshedOrder)];
    }
    await appendReceipt(state, "execution.result", { decisionId: row.id, status: stored.status, rail, railError });
  });
}
export async function reviewDecision(id: string, action: unknown, user: Identity) {
  requireSandboxSeller(user);
  await ensureLedger();
  if (action === "approve") {
    const previous = decisions((await readState()).state).find(value => value.id === id);
    if (previous?.kind === "refund") await importOrder(previous.plan.targetId, user);
    if (previous?.kind === "dispute") await importDispute(previous.plan.targetId, user);
  }
  if (action !== "approve" && action !== "reject") throw new HttpError(400, "Choose approve or reject.");
  const row = await mutateState(async state => {
    const stored = decisions(state).find(value => value.id === id);
    if (!stored) throw new HttpError(404, "Decision not found.");
    if (stored.arena) throw new HttpError(409, "Arena entries cannot receive seller approval.");
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
    Object.assign(stored, checked, { verdict: "allow", status: "pending", executionKey: checked.execution.idempotencyKey, approval: { by: user.id, at, action, diff } });
    await appendReceipt(state, "decision.approved", { decisionId: id, ...stored.approval, plan, execution: checked.execution, provenance: checked.provenance });
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
      if (state.vendors.length >= 100 && !before) throw new HttpError(409, "This workspace supports up to 100 verified vendors.");
      state.vendors = [...state.vendors.filter(value2 => (value2 as Vendor).id !== id), vendor];
      await appendReceipt(state, "vendor.verified", { by: user.id, before: before ?? null, after: vendor, authority: "explicit seller setting" });
    } else if (body.type === "customer") {
      const value = body.customer as Partial<Customer> | undefined;
      if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || typeof value.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 254 || value.verified !== true) throw new HttpError(400, "Explicitly verify a customer name and email address.");
      const id = typeof value.id === "string" && /^customer-[a-z0-9-]{1,60}$/.test(value.id) ? value.id : `customer-${crypto.randomUUID()}`;
      const before = (state.customers as Customer[]).find(customer => customer.id === id);
      const customer: Customer = { id, name: value.name.trim(), email: value.email.trim().toLowerCase(), verified: true };
      if (state.customers.length >= 100 && !before) throw new HttpError(409, "This workspace supports up to 100 verified customers.");
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
  requireSandboxSeller(user);
  if (railMode() !== "sandbox") throw new HttpError(409, "Trusted record import is available only in server-configured sandbox mode.");
  if (typeof id !== "string") throw new HttpError(400, "A PayPal sandbox order ID is required.");
  const order = await getSandboxOrder(id);
  await ensureLedger();
  await mutateState(async state => {
    const before = (state.orders as Order[]).find(value => value.id === order.id);
    const merged = mergeTrustedOrder(before, order);
    confirmRefundSnapshot(state, order);
    state.orders = [...state.orders.filter(value => (value as Order).id !== order.id), merged];
    await appendReceipt(state, "paypal.order.imported", { by: user.id, order: merged });
  });
  return { order, state: await appState(user) };
}

export async function importDispute(id: unknown, user: Identity) {
  requireSandboxSeller(user);
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
  requireSandboxSeller(user);
  if (railMode() !== "sandbox" || !sandboxConfigured()) throw new HttpError(409, "Checkout requires server-configured sandbox credentials and seller identity.");
  if (body.action !== "create" && body.action !== "capture") throw new HttpError(400, "Choose create or capture.");
  if (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.requestId)) throw new HttpError(400, "Provide a stable requestId of 8–80 letters, digits, underscores or hyphens.");
  const create = body.action === "create";
  if (create && (!Number.isSafeInteger(body.amountCents) || (body.amountCents as number) < 1 || (body.amountCents as number) > 1000000)) throw new HttpError(400, "Checkout amount must be 1–1,000,000 USD cents.");
  if (!create && (typeof body.orderId !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(body.orderId) || body.orderId.startsWith("DEMO-"))) throw new HttpError(400, "Provide the actual sandbox order ID.");
  await ensureLedger();
  if (!create) {
    const stored = (await readState()).state;
    const original = stored.paypalOperations?.find(value => value.kind === "create_order" && value.status === "completed" && value.orderId === body.orderId);
    if (!original) throw new HttpError(409, "Capture only an order created through this seller's checkout flow.");
    if (!stored.paypalOperations?.some(value => value.kind === "capture_order" && value.orderId === body.orderId)) {
      const upstream = await getSandboxCheckoutOrder(body.orderId as string);
      if (upstream.id !== body.orderId || upstream.status !== "APPROVED") throw new HttpError(409, "The buyer must approve this exact sandbox order before capture. No capture was reserved or sent.");
      const units = Array.isArray(upstream.purchase_units) ? upstream.purchase_units as Record<string, unknown>[] : [];
      const amount = units[0]?.amount as Record<string, unknown> | undefined;
      if (units.length !== 1 || exactPayPalCents(amount?.value) !== original.amountCents || amount?.currency_code !== "USD") throw new HttpError(409, "PayPal order amount or currency differs from the checkout reservation. No capture was sent.");
    }
  }
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
      if (!authoritative || !row.execution) continue;
      let matches = row.rail?.reference === resourceId;
      const expected = `CUSTODY-${(await sha256(row.execution.idempotencyKey)).slice(0, 48)}`;
      if (!matches) {
        const batch = authoritative.batch_header as Record<string, unknown> | undefined;
        const sender = batch?.sender_batch_header as Record<string, unknown> | undefined;
        const detail = authoritative.detail as Record<string, unknown> | undefined;
        matches = family === "payout" && row.kind === "pay_invoice" && sender?.sender_batch_id === expected
          || family === "refund" && row.kind === "refund" && authoritative.custom_id === expected
          || family === "invoice" && row.kind === "send_invoice" && detail?.memo === expected;
      }
      if (!matches) continue;
      updates.push(await applyReconciliation(state, row, authoritative, resourceId));
    }
    events.push(id);
    await appendReceipt(state, "paypal.webhook.verified", { eventId: id, eventType: type, resourceId, family, updates });
    return { received: true, duplicate: false, reconciled: updates.length };
  });
}

async function applyReconciliation(state: LedgerState, row: StoredDecision, authoritative: Record<string, unknown>, resourceId: string) {
  const before = { status: row.status, railStatus: row.rail?.status };
  const expected = `CUSTODY-${(await sha256(row.execution!.idempotencyKey)).slice(0, 48)}`;
  const mismatch = reconciliationMismatch(row.kind, row.execution!, authoritative, resourceId, expected);
  if (mismatch) {
    row.status = "failed";
    row.railError = mismatch;
    await appendReceipt(state, "execution.drift.detected", { decisionId: row.id, resourceId, reason: mismatch });
    return { decisionId: row.id, status: row.status, error: mismatch };
  }
  row.rail ??= { mode: "sandbox", reference: resourceId, status: "PENDING" };
  if (row.kind === "pay_invoice") {
    const header = authoritative.batch_header as Record<string, unknown>;
    const items = authoritative.items as Record<string, unknown>[];
    row.rail.status = typeof header.batch_status === "string" ? header.batch_status : "PENDING";
    if (items[0].transaction_status === "SUCCESS") row.status = "paid";
    else if (["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED", "CANCELED"].includes(String(items[0].transaction_status)) || ["DENIED", "CANCELED"].includes(row.rail.status)) row.status = "failed";
    else row.status = "pending";
  } else if (row.kind === "refund") {
    row.rail.status = typeof authoritative.status === "string" ? authoritative.status : "PENDING";
    if (row.rail.status === "COMPLETED") row.status = "refunded";
    else if (["FAILED", "CANCELLED"].includes(row.rail.status)) row.status = "failed";
    else row.status = "pending";
  } else if (row.kind === "send_invoice") {
    row.rail.status = typeof authoritative.status === "string" ? authoritative.status : "UNKNOWN";
    row.status = invoiceExecutionStatus(row.status as "invoiced" | "pending" | "failed", row.rail.status);
  }
  if (!["pending", "failed"].includes(row.status)) row.railError = undefined;
  await appendReceipt(state, "execution.reconciled", { decisionId: row.id, before, after: { status: row.status, railStatus: row.rail.status } });
  return { decisionId: row.id, status: row.status };
}
/** Authenticated provider GETs work even when private hosting blocks callbacks. */
export async function reconcileDecisions(body: Record<string, unknown>, user: Identity) {
  requireSandboxSeller(user);
  if (body.decisionId !== undefined && (typeof body.decisionId !== "string" || body.decisionId.length > 100)) throw new HttpError(400, "Choose a stored decision ID.");
  await ensureLedger();
  const all = decisions((await readState()).state);
  if (typeof body.decisionId === "string" && !all.some(value => value.id === body.decisionId)) throw new HttpError(404, "Decision not found.");
  if (typeof body.decisionId === "string" && !all.find(value => value.id === body.decisionId)?.rail?.reference) throw new HttpError(409, "This action has no confirmed PayPal resource reference. Locate it in the sandbox dashboard and import its order; no provider action was retried.");
  const selected = all.filter(value => !value.arena && value.mode === "sandbox" && value.execution && value.rail?.reference && (body.decisionId ? value.id === body.decisionId : ["pending", "failed"].includes(value.status))).slice(0, 20);
  const results: { decisionId: string; status: string; error?: string }[] = [];
  const operations: { operationId: string; status: string; error?: string }[] = [];
  for (const row of selected) {
    try {
      const ref = row.rail!.reference;
      const authoritative = row.kind === "pay_invoice" ? await getSandboxPayout(ref) : row.kind === "refund" ? await getSandboxRefund(ref) : row.kind === "send_invoice" ? await getSandboxInvoice(ref) : await getSandboxDispute(ref);
      const refreshedOrder = row.kind === "refund" ? await getSandboxOrder(row.plan.targetId).catch(() => undefined) : undefined;
      results.push(await mutateState(async state => {
        const current = decisions(state).find(value => value.id === row.id)!;
        if (refreshedOrder) {
          const previous = (state.orders as Order[]).find(value => value.id === refreshedOrder.id);
          state.orders = [...state.orders.filter(value => (value as Order).id !== refreshedOrder.id), mergeTrustedOrder(previous, refreshedOrder)];
        }
        const result = await applyReconciliation(state, current, authoritative, ref);
        if (refreshedOrder) confirmRefundSnapshot(state, refreshedOrder);
        return result;
      }));
    } catch (error) { results.push({ decisionId: row.id, status: row.status, error: error instanceof HttpError ? error.message : "PayPal status is unavailable; the reserved action was not resubmitted." }); }
  }
  if (!body.decisionId) {
    const pendingCaptures = ((await readState()).state.paypalOperations ?? []).filter(value => value.kind === "capture_order" && value.orderId && ["failed", "reserved"].includes(value.status)).slice(0, 10);
    for (const operation of pendingCaptures) {
      try {
        const trusted = await getSandboxOrder(operation.orderId!);
        if (trusted.paymentStatus !== "COMPLETED") { operations.push({ operationId: operation.id, status: operation.status, error: "PayPal has not confirmed a completed capture." }); continue; }
        operations.push(await mutateState(async state => {
          const stored = state.paypalOperations!.find(value => value.id === operation.id)!;
          const original = state.paypalOperations!.find(value => value.kind === "create_order" && value.orderId === trusted.id);
          if (trusted.capturedCents !== original?.amountCents || trusted.currency !== "USD") throw new HttpError(409, "Captured amount or currency differs from this checkout's reservation.");
          const before = (state.orders as Order[]).find(value => value.id === trusted.id);
          state.orders = [...state.orders.filter(value => (value as Order).id !== trusted.id), mergeTrustedOrder(before, trusted)];
          stored.status = "completed";
          stored.error = undefined;
          stored.result = { orderId: trusted.id, status: "COMPLETED", captureId: trusted.captureId, captureStatus: trusted.paymentStatus, amountCents: trusted.capturedCents, currency: trusted.currency };
          await appendReceipt(state, "checkout.reconciled", { operationId: stored.id, result: stored.result });
          return { operationId: stored.id, status: stored.status };
        }));
      } catch (error) { operations.push({ operationId: operation.id, status: operation.status, error: error instanceof HttpError ? error.message : "Capture status remains uncertain; no capture was resubmitted." }); }
    }
  }
  return { results, operations, queried: selected.length + operations.length, state: await appState(user) };
}

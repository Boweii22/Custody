/**
 * Custody's deterministic authority boundary. No network, model, clock, or I/O.
 * A provenance label is a claim; the value must also match the canonical store.
 */
export type Label =
  | "tainted:email" | "tainted:model" | "tainted:derived"
  | "trusted:vendor_book" | "trusted:paypal" | "trusted:customer_book"
  | "trusted:policy" | "trusted:approval";
export type PaymentKind = "pay_invoice" | "refund" | "send_invoice" | "dispute";
export interface Labeled<T = unknown> { value: T; label: Label; source: string }
export interface Vendor {
  id: string; name: string; aliases: string[]; email: string;
  verified: boolean; limitCents: number; category: string;
}
export interface Customer { id: string; name: string; email: string; verified: boolean }
export interface Order {
  id: string; customerId: string; customerName: string; captureId: string;
  capturedCents: number; refundedCents: number; currency: string; capturedAt: string;
  paymentStatus: "COMPLETED" | "PENDING"; description: string;
  trackingNumber?: string; carrier?: string; deliveredAt?: string;
}
export interface Dispute {
  id: string; orderId: string; status: "OPEN" | "RESOLVED"; deadline: string;
  reason: string;
}
export interface Policy {
  id: string; name: string; version: number; kind: PaymentKind; enabled: boolean;
  maxAmountCents: number; currency: "USD"; refundWindowDays?: number;
  description: string;
}
export interface KernelContext {
  now: string; vendors: readonly Vendor[]; customers: readonly Customer[];
  orders: readonly Order[]; disputes: readonly Dispute[];
  settledInvoiceKeys: readonly string[];
}
export interface PaymentPlan {
  kind: PaymentKind; targetId: string; sourceId: string;
  args: Record<string, Labeled>;
}
export interface Reason { code: string; field: string; message: string }
export interface Check { id: string; label: string; passed: boolean; message: string }
export interface ProvenanceField {
  field: string; value: unknown; label: Label; source: string;
  required?: Label; authoritative: boolean;
}
export interface Execution {
  tool: string; args: Record<string, unknown>; idempotencyKey: string;
}
export interface Decision {
  status: "allow" | "hold" | "block"; reasons: Reason[]; checks: Check[];
  provenance: ProvenanceField[]; tool: string; plan: PaymentPlan; execution?: Execution;
}

export const TOOL_NAMES: Record<PaymentKind, string> = {
  pay_invoice: "paypal.payouts.create", refund: "paypal.payments.refund",
  send_invoice: "paypal.invoicing.send", dispute: "paypal.disputes.provide_evidence",
};
export function labeled<T>(value: T, label: Label, source: string): Labeled<T> {
  return { value, label, source };
}
/** Derivations never remove taint. Mixing trust domains also needs re-resolution. */
export function derive<T>(value: T, inputs: readonly Labeled[], source = "derived"): Labeled<T> {
  const first = inputs[0]?.label;
  const label: Label = first && first.startsWith("trusted:") && inputs.every(x => x.label === first)
    ? first : "tainted:derived";
  return labeled(value, label, source);
}
export function normalizeInvoice(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}
export function invoiceKey(kind: PaymentKind, targetId: string, invoice: string): string {
  return JSON.stringify([kind, targetId, normalizeInvoice(invoice)]);
}
function money(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function validLabel(value: unknown): value is Labeled {
  return !!value && typeof value === "object" && "value" in value && "label" in value
    && typeof (value as Labeled).label === "string" && typeof (value as Labeled).source === "string";
}

/**
 * Every allow contains a new, minimal execution object. No caller-supplied tool
 * name, extra argument, address, capture ID, or arbitrary evidence is forwarded.
 */
export function decide(plan: PaymentPlan, policy: Policy, context: KernelContext): Decision {
  const reasons: Reason[] = [];
  const checks: Check[] = [];
  const authoritative = new Set<string>();
  const required = new Map<string, Label>();
  let blocked = false;
  const args = plan?.args && typeof plan.args === "object" ? plan.args : {};
  const kind = plan?.kind;
  const tool = TOOL_NAMES[kind] ?? "unsupported";
  const value = (field: string): unknown => validLabel(args[field]) ? args[field].value : undefined;
  const check = (id: string, label: string, passed: boolean, message: string, field = id, block = false) => {
    checks.push({ id, label, passed, message });
    if (!passed) { reasons.push({ code: id, field, message }); blocked ||= block; }
    return passed;
  };
  const authority = (field: string, expectedLabel: Label, expectedValue: unknown, origin: string) => {
    required.set(field, expectedLabel);
    const argument = args[field];
    const passed = validLabel(argument) && argument.label === expectedLabel
      && typeof expectedValue === "string" && expectedValue.length > 0 && argument.value === expectedValue;
    check(`${field}_provenance`, `${field} has trusted provenance`, passed,
      passed ? `${field} resolved from ${origin}.` : `${field} must match ${origin}; inbox values and caller labels cannot authorize it.`, field, true);
    if (passed) authoritative.add(field);
  };
  check("supported_action", "Supported playbook", Object.hasOwn(TOOL_NAMES, kind), "Action must match a supported Custody playbook.", "kind", true);
  check("policy_match", "Standing policy is active", !!policy && policy.enabled === true && policy.kind === kind
    && Number.isSafeInteger(policy.version) && policy.version > 0,
    "An enabled, versioned standing policy must authorize this action.", "policy", true);
  check("policy_cap", "Policy cap is valid", money(policy?.maxAmountCents) && policy?.currency === "USD",
    "The standing policy must provide a positive integer USD cap.", "policy", true);
  const now = Date.parse(context.now);
  check("clock_valid", "Trusted evaluation time", Number.isFinite(now), "The trusted evaluation time must be a valid timestamp.", "now", true);

  let amount = value("amountCents");
  if (kind !== "dispute") {
    check("amount_valid", "Exact positive cents", money(amount), "Amount must be a positive, safe integer number of cents.", "amountCents", true);
    check("currency_usd", "USD only", value("currency") === "USD", "Only USD is authorized by this standing policy.", "currency", true);
    check("amount_cap", "Within standing spend cap", money(amount) && money(policy?.maxAmountCents) && amount <= policy.maxAmountCents,
      `Amount must stay within the standing cap of ${policy?.maxAmountCents ?? 0} cents.`, "amountCents");
  }
  const invoice = value("invoiceNumber");
  let key = invoiceKey(kind, plan?.targetId ?? "", typeof invoice === "string" ? invoice : plan?.sourceId ?? "");
  if (kind === "pay_invoice" || kind === "send_invoice") {
    const maxLength = kind === "send_invoice" ? 25 : 100;
    const present = typeof invoice === "string" && normalizeInvoice(invoice).length > 0 && invoice.length <= maxLength;
    check("invoice_present", "Invoice reference present", present, `An invoice reference of 1–${maxLength} characters is required.`, "invoiceNumber");
    check("invoice_unique", "Invoice has not been executed", present && !context.settledInvoiceKeys.includes(key),
      "This invoice reference must not already exist in the executed ledger.", "invoiceNumber", true);
  }
  let executionArgs: Record<string, unknown> = {};
  if (kind === "pay_invoice") {
    const vendor = context.vendors.find(v => v.id === plan.targetId);
    check("vendor_known", "Vendor is in the book", !!vendor && vendor.verified === true,
      "The vendor must exist and be verified in the merchant's vendor book.", "vendor");
    authority("receiver", "trusted:vendor_book", vendor?.email, "the verified vendor book");
    check("vendor_cap", "Within vendor allowance", !!vendor && money(vendor.limitCents) && money(amount) && amount <= vendor.limitCents,
      "The amount must also fit the selected vendor's allowance.", "amountCents");
    executionArgs = { receiver: vendor?.email, amountCents: amount, currency: "USD", invoiceNumber: invoice, vendorId: vendor?.id };
  } else if (kind === "refund") {
    const order = context.orders.find(o => o.id === plan.targetId);
    check("order_known", "Captured order exists", !!order && order.paymentStatus === "COMPLETED",
      "Refunds require an original, completed capture from the trusted order store.", "order");
    authority("captureId", "trusted:paypal", order?.captureId, "the original PayPal capture");
    check("order_currency", "Original capture is USD", order?.currency === "USD", "The original capture must be denominated in USD.", "currency", true);
    const remaining = order && Number.isSafeInteger(order.capturedCents) && Number.isSafeInteger(order.refundedCents)
      && order.capturedCents > 0 && order.refundedCents >= 0 ? order.capturedCents - order.refundedCents : -1;
    check("refund_remaining", "Within remaining captured amount", money(amount) && amount <= remaining,
      "Refund cannot exceed the captured amount less refunds already recorded.", "amountCents");
    const capturedAt = Date.parse(order?.capturedAt ?? "");
    const days = policy?.refundWindowDays;
    check("refund_window", "Inside refund window", Number.isFinite(now) && Number.isFinite(capturedAt)
      && Number.isSafeInteger(days) && (days ?? 0) > 0 && now >= capturedAt && now - capturedAt <= (days ?? 0) * 86_400_000,
      `The original capture must be within the ${days ?? 0}-day refund window.`, "capturedAt");
    // Recipient fields are never supported by the refund rail, even if supplied as extras.
    if (args.recipient || args.receiver) check("refund_redirect", "Refund returns to original payer", false,
      "Refunds cannot specify an alternate receiver or recipient.", "recipient", true);
    key = JSON.stringify([kind, plan.targetId, plan.sourceId]);
    check("refund_unique", "Refund request has not executed", !!plan.sourceId && !context.settledInvoiceKeys.includes(key),
      "This refund request must not already be recorded in the executed ledger.", "sourceId", true);
    executionArgs = { captureId: order?.captureId, amountCents: amount, currency: "USD", orderId: order?.id };
  } else if (kind === "send_invoice") {
    const customer = context.customers.find(c => c.id === plan.targetId);
    check("customer_known", "Customer is in the book", !!customer && customer.verified === true,
      "The invoice recipient must be a verified customer in the merchant's customer book.", "customer");
    authority("recipient", "trusted:customer_book", customer?.email, "the verified customer book");
    executionArgs = { recipient: customer?.email, amountCents: amount, currency: "USD", invoiceNumber: invoice, customerId: customer?.id };
  } else if (kind === "dispute") {
    const dispute = context.disputes.find(d => d.id === plan.targetId);
    const order = context.orders.find(o => o.id === dispute?.orderId);
    check("dispute_open", "Dispute is open", !!dispute && dispute.status === "OPEN", "Evidence may only be submitted for an open dispute.", "dispute");
    authority("disputeId", "trusted:paypal", dispute?.id, "the PayPal dispute record");
    authority("captureId", "trusted:paypal", order?.captureId, "the dispute's original capture");
    const deadline = Date.parse(dispute?.deadline ?? "");
    check("dispute_deadline", "Before evidence deadline", Number.isFinite(deadline) && Number.isFinite(now) && now <= deadline,
      "Dispute evidence must be submitted before the trusted deadline.", "deadline");
    check("evidence_available", "Evidence from merchant records", !!order?.trackingNumber && !!order?.carrier && !!order?.deliveredAt,
      "Shipping evidence must exist in the merchant's trusted order records.", "evidence");
    if (args.recipient || args.receiver) check("dispute_redirect", "Evidence submits to original dispute", false,
      "Dispute evidence cannot introduce a payment recipient.", "recipient", true);
    key = JSON.stringify([kind, plan.targetId]);
    check("dispute_unique", "Evidence has not already submitted", !context.settledInvoiceKeys.includes(key),
      "Evidence for this dispute must not already be recorded in the executed ledger.", "disputeId", true);
    executionArgs = { disputeId: dispute?.id, captureId: order?.captureId, trackingNumber: order?.trackingNumber,
      carrier: order?.carrier, deliveredAt: order?.deliveredAt, orderId: order?.id };
    amount = 0;
  }
  const provenance: ProvenanceField[] = Object.entries(args).filter((entry): entry is [string, Labeled] => validLabel(entry[1]))
    .map(([field, argument]) => ({ field, value: argument.value, label: argument.label, source: argument.source,
      required: required.get(field), authoritative: authoritative.has(field) }));
  const status = reasons.length === 0 ? "allow" : blocked ? "block" : "hold";
  return { status, reasons, checks, provenance, tool, plan,
    ...(status === "allow" ? { execution: { tool, args: executionArgs, idempotencyKey: key } } : {}) };
}

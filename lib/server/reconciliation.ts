import type { Execution, Order, PaymentKind } from "../kernel.ts";

export type ExecutionStatus = "paid" | "refunded" | "invoiced" | "evidence" | "pending" | "failed";

/** A Payouts batch SUCCESS means processed, not that its recipient was paid. */
export function synchronousExecutionStatus(kind: PaymentKind, upstreamStatus: string): ExecutionStatus {
  if (kind === "refund" && upstreamStatus === "COMPLETED") return "refunded";
  if (kind === "send_invoice") return invoiceExecutionStatus("pending", upstreamStatus);
  if (kind === "dispute" && upstreamStatus === "EVIDENCE_SUBMITTED") return "evidence";
  return "pending";
}

/** Recover uncertain sends only after PayPal confirms the invoice left draft. */
export function invoiceExecutionStatus(current: ExecutionStatus, upstreamStatus: string): ExecutionStatus {
  if (["SENT", "UNPAID", "PAID", "MARKED_AS_PAID", "PARTIALLY_PAID", "PAYMENT_PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED"].includes(upstreamStatus)) return "invoiced";
  if (upstreamStatus === "CANCELLED") return "failed";
  return current;
}

/** Refreshes cannot erase explicit merchant evidence or local refund accounting. */
export function mergeTrustedOrder(previous: Order | undefined, current: Order): Order {
  return { ...previous, ...current, refundedCents: Math.max(current.refundedCents, previous?.refundedCents ?? 0) };
}

/** Parse decimal money without rounding or accepting values beyond exact cents. */
export function exactPayPalCents(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [major, minor = ""] = value.split(".");
  const cents = Number(major) * 100 + Number(minor.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

type ProviderRecord = Record<string, unknown>;
const record = (value: unknown): ProviderRecord => value && typeof value === "object" && !Array.isArray(value) ? value as ProviderRecord : {};
const records = (value: unknown): ProviderRecord[] => Array.isArray(value) ? value.map(record) : [];
/** Refetched provider data must describe the exact reserved destination and amount. */
export function reconciliationMismatch(kind: PaymentKind, execution: Execution, resource: ProviderRecord, resourceId: string, requestKey: string): string | undefined {
  const args = execution.args;
  const amountMatches = (value: unknown, currencyKey = "currency_code") => {
    const amount = record(value);
    return exactPayPalCents(amount.value) === args.amountCents && amount[currencyKey] === "USD";
  };
  if (kind === "pay_invoice") {
    const header = record(resource.batch_header);
    if (header.payout_batch_id !== resourceId || record(header.sender_batch_header).sender_batch_id !== requestKey) return "PayPal payout identity differs from the reserved action.";
    const items = records(resource.items);
    if (items.length !== 1) return "The payout must contain exactly the single authorized item.";
    const item = record(items[0].payout_item);
    if (item.receiver !== args.receiver || item.sender_item_id !== requestKey || !amountMatches(item.amount, "currency")) return "PayPal payout recipient, amount, currency, or item identity differs from the authorized action.";
  } else if (kind === "refund") {
    if (resource.id !== resourceId || !amountMatches(resource.amount)) return "PayPal refund identity, amount, or currency differs from the authorized action.";
    const related = record(record(resource.supplementary_data).related_ids);
    const capture = records(resource.links).find(value => value.rel === "up")?.href;
    let captureId = related.capture_id;
    if (!captureId && typeof capture === "string") {
      try { const url = new URL(capture); if (["https://api-m.sandbox.paypal.com", "https://api.sandbox.paypal.com"].includes(url.origin)) captureId = url.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9-]+)$/)?.[1]; } catch { /* Untrusted link cannot prove capture binding. */ }
    }
    if (captureId !== args.captureId) return "PayPal refund does not prove the original authorized capture binding.";
    if (resource.custom_id !== requestKey) return "PayPal refund request identity differs from the reserved action.";
  } else if (kind === "send_invoice") {
    const recipient = records(resource.primary_recipients);
    if (resource.id !== resourceId || record(resource.detail).memo !== requestKey || recipient.length !== 1 || record(recipient[0].billing_info).email_address !== args.recipient || !amountMatches(resource.amount)) return "PayPal invoice identity, recipient, total, or currency differs from the authorized action.";
  }
  return undefined;
}

import type { Order, PaymentKind } from "../kernel.ts";

export type ExecutionStatus = "paid" | "refunded" | "invoiced" | "evidence" | "pending" | "failed";

/** A Payouts batch SUCCESS means processed, not that its recipient was paid. */
export function synchronousExecutionStatus(kind: PaymentKind, upstreamStatus: string): ExecutionStatus {
  if (kind === "refund" && upstreamStatus === "COMPLETED") return "refunded";
  if (kind === "send_invoice" && upstreamStatus === "SENT") return "invoiced";
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

import test from "node:test";
import assert from "node:assert/strict";
import type { Order } from "../lib/kernel.ts";
import { exactPayPalCents, invoiceExecutionStatus, mergeTrustedOrder, synchronousExecutionStatus } from "../lib/server/reconciliation.ts";

test("a processed payout batch does not claim that its recipient was paid", () => {
  for (const status of ["SUCCESS", "COMPLETED", "PENDING", "PROCESSING"]) {
    assert.equal(synchronousExecutionStatus("pay_invoice", status), "pending");
  }
  assert.equal(synchronousExecutionStatus("refund", "COMPLETED"), "refunded");
  assert.equal(synchronousExecutionStatus("refund", "PENDING"), "pending");
  assert.equal(synchronousExecutionStatus("send_invoice", "SENT"), "invoiced");
  assert.equal(synchronousExecutionStatus("dispute", "EVIDENCE_SUBMITTED"), "evidence");
  assert.equal(synchronousExecutionStatus("refund", "SENT"), "pending");
});

test("confirmed invoice webhooks recover an uncertain send without promoting drafts", () => {
  for (const status of ["SENT", "UNPAID", "PAID", "PARTIALLY_PAID", "REFUNDED"]) {
    assert.equal(invoiceExecutionStatus("failed", status), "invoiced");
    assert.equal(invoiceExecutionStatus("pending", status), "invoiced");
  }
  for (const status of ["DRAFT", "SCHEDULED", "UNKNOWN"]) assert.equal(invoiceExecutionStatus("pending", status), "pending");
  assert.equal(invoiceExecutionStatus("invoiced", "CANCELLED"), "failed");
});

test("a checkout refresh cannot erase evidence or a concurrent local refund", () => {
  const original: Order = { id: "ORDER123", captureId: "CAPTURE123", customerId: "payer", customerName: "Customer", capturedCents: 10000, refundedCents: 2500, currency: "USD", capturedAt: "2026-10-25T09:00:00Z", paymentStatus: "COMPLETED", description: "Order", trackingNumber: "TRACK123", carrier: "USPS", deliveredAt: "2026-10-25T10:00:00Z" };
  const fresh: Order = { id: "ORDER123", captureId: "CAPTURE123", customerId: "payer", customerName: "Customer", capturedCents: 10000, refundedCents: 0, currency: "USD", capturedAt: "2026-10-25T09:00:00Z", paymentStatus: "COMPLETED", description: "Upstream description" };
  const merged = mergeTrustedOrder(original, fresh);
  assert.equal(merged.refundedCents, 2500);
  assert.equal(merged.trackingNumber, "TRACK123");
  assert.equal(merged.description, "Upstream description");
  assert.equal(mergeTrustedOrder(original, { ...fresh, refundedCents: 5000 }).refundedCents, 5000);
  assert.deepEqual(mergeTrustedOrder(undefined, fresh), fresh);
});

test("upstream monetary values must be exact nonnegative safe integer cents", () => {
  assert.equal(exactPayPalCents("12.34"), 1234);
  assert.equal(exactPayPalCents("0"), 0);
  assert.equal(exactPayPalCents("1.2"), 120);
  for (const value of ["1.234", "-1.00", "NaN", "1e3", "9007199254740991.00", 1, null, undefined]) assert.equal(exactPayPalCents(value), undefined);
});

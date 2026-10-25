import test from "node:test";
import assert from "node:assert/strict";
import type { Order } from "../lib/kernel.ts";
import { exactPayPalCents, reconciliationMismatch, invoiceExecutionStatus, mergeTrustedOrder, synchronousExecutionStatus } from "../lib/server/reconciliation.ts";

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

test("provider reconciliation rejects drift before recording settlement", () => {
  const key = "CUSTODY-REQUEST";
  const payout = { tool: "paypal.payouts.create", args: { receiver: "receiver@merchant.com", amountCents: 1234 }, idempotencyKey: "request" };
  const paid = { batch_header: { payout_batch_id: "BATCH123", sender_batch_header: { sender_batch_id: key } }, items: [{ transaction_status: "SUCCESS", payout_item: { receiver: "receiver@merchant.com", sender_item_id: key, amount: { value: "12.34", currency: "USD" } } }] };
  assert.equal(reconciliationMismatch("pay_invoice", payout, paid, "BATCH123", key), undefined);
  for (const change of [{ receiver: "attacker@merchant.com" }, { amount: { value: "99.00", currency: "USD" } }, { amount: { value: "12.34", currency: "EUR" } }, { sender_item_id: "different" }]) {
    const drift = structuredClone(paid);
    Object.assign(drift.items[0].payout_item, change);
    assert.match(reconciliationMismatch("pay_invoice", payout, drift, "BATCH123", key)!, /differs/);
  }
  assert.ok(reconciliationMismatch("pay_invoice", payout, { ...paid, items: [] }, "BATCH123", key));
  const refund = { tool: "paypal.payments.refund", args: { captureId: "CAPTURE123", amountCents: 1234 }, idempotencyKey: "request" };
  const refunded = { id: "REFUND123", status: "COMPLETED", custom_id: key, amount: { value: "12.34", currency_code: "USD" }, links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE123" }] };
  assert.equal(reconciliationMismatch("refund", refund, refunded, "REFUND123", key), undefined);
  assert.ok(reconciliationMismatch("refund", refund, { ...refunded, links: [{ rel: "up", href: "https://attacker.com/v2/payments/captures/CAPTURE123" }] }, "REFUND123", key));
  assert.ok(reconciliationMismatch("refund", refund, { ...refunded, custom_id: "another-request" }, "REFUND123", key));
  const invoice = { tool: "paypal.invoicing.send", args: { recipient: "customer@merchant.com", amountCents: 1234 }, idempotencyKey: "request" };
  const invoiced = { id: "INV123", detail: { memo: key }, amount: { value: "12.34", currency_code: "USD" }, primary_recipients: [{ billing_info: { email_address: "customer@merchant.com" } }] };
  assert.equal(reconciliationMismatch("send_invoice", invoice, invoiced, "INV123", key), undefined);
  assert.ok(reconciliationMismatch("send_invoice", invoice, { ...invoiced, amount: { value: "12.35", currency_code: "USD" } }, "INV123", key));
});

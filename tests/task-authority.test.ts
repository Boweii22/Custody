import test from "node:test";
import assert from "node:assert/strict";
import { decide, labeled, type KernelContext, type PaymentPlan, type Policy } from "../lib/kernel.ts";
import { applyTaskAuthorization, parseTaskAuthorization, type TaskAuthorization } from "../lib/task-authority.ts";

const now = "2026-10-29T06:00:00Z";
const context: KernelContext = { now, vendors: [], customers: [], disputes: [], settledInvoiceKeys: [], orders: [
  { id: "ORDER-A", captureId: "CAPTURE-A", customerId: "buyer-a", customerName: "Buyer A", capturedCents: 1000, refundedCents: 0, currency: "USD", capturedAt: "2026-10-28T06:00:00Z", paymentStatus: "COMPLETED", description: "Explicit software-test fixture" },
  { id: "ORDER-B", captureId: "CAPTURE-B", customerId: "buyer-b", customerName: "Buyer B", capturedCents: 1000, refundedCents: 0, currency: "USD", capturedAt: "2026-10-28T06:00:00Z", paymentStatus: "COMPLETED", description: "Explicit software-test fixture" },
] };
const policy: Policy = { id: "refunds", kind: "refund", name: "Refunds", version: 1, enabled: true, maxAmountCents: 1000, currency: "USD", refundWindowDays: 30, description: "Test policy" };
function plan(targetId = "ORDER-A", amountCents = 100): PaymentPlan {
  return { kind: "refund", targetId, sourceId: "test-source", args: {
    amountCents: labeled(amountCents, "tainted:model", "Test model"), currency: labeled("USD", "tainted:model", "Test model"),
    captureId: labeled(`CAPTURE-${targetId.at(-1)}`, "trusted:paypal", "Test provider fixture"),
  } };
}
const task: TaskAuthorization = { kind: "refund", targetId: "ORDER-A", maxAmountCents: 100, confirmed: true };

test("an otherwise valid refund cannot select another legitimately refundable order", () => {
  const modelSelectedOther = decide(plan("ORDER-B"), policy, context);
  assert.equal(modelSelectedOther.status, "allow");
  const checked = applyTaskAuthorization(modelSelectedOther, task);
  assert.equal(checked.status, "block");
  assert.equal(checked.execution, undefined);
  assert.equal(checked.checks.find(check => check.id === "task_target")?.passed, false);
  assert.equal(checked.checks.find(check => check.id === "task_amount")?.passed, true);
});

test("task binding refuses missing authorization and model-selected playbook changes", () => {
  const base = decide(plan(), policy, context);
  assert.equal(applyTaskAuthorization(base, undefined).status, "block");
  assert.equal(applyTaskAuthorization(base, undefined).execution, undefined);
  const swapped = applyTaskAuthorization(base, { ...task, kind: "send_invoice" });
  assert.equal(swapped.status, "block");
  assert.equal(swapped.checks.find(check => check.id === "task_kind")?.passed, false);
  assert.equal(swapped.execution, undefined);
});

test("standing allowance cannot enlarge the merchant's per-task ceiling", () => {
  const base = decide(plan("ORDER-A", 500), policy, context);
  assert.equal(base.status, "allow");
  const checked = applyTaskAuthorization(base, task);
  assert.equal(checked.status, "block");
  assert.equal(checked.checks.find(check => check.id === "task_amount")?.passed, false);
  assert.equal(checked.execution, undefined);
});

test("valid merchant binding preserves only the already checked minimal execution", () => {
  const base = decide(plan(), policy, context);
  const checked = applyTaskAuthorization(base, task);
  assert.equal(checked.status, "allow");
  assert.deepEqual(checked.execution, base.execution);
  assert.ok(checked.checks.every(check => check.passed));
  assert.deepEqual(checked.provenance.filter(field => field.field.startsWith("ownerTask.")).map(field => field.label), ["trusted:approval", "trusted:approval", "trusted:approval"]);
  const exhausted = structuredClone(context); exhausted.orders[0].refundedCents = 1000;
  const held = applyTaskAuthorization(decide(plan(), policy, exhausted), task);
  assert.equal(held.status, "hold");
  assert.equal(held.execution, undefined);
});

test("task parsing does not accept message-style labels, caller actors, or loose amounts", () => {
  assert.deepEqual(parseTaskAuthorization(task), task);
  for (const bad of [undefined, null, {}, [], { ...task, confirmed: false }, { ...task, by: "forged-owner" },
    { ...task, at: now }, { ...task, maxAmountCents: "100" }, { ...task, maxAmountCents: 1.5 },
    { ...task, maxAmountCents: 0 }, { ...task, maxAmountCents: 1000001 }, { ...task, maxAmountCents: Number.POSITIVE_INFINITY },
    { ...task, kind: "production-refund" }, { ...task, targetId: " ORDER-A" }, { ...task, targetId: "other@example.com" },
    { ...task, targetId: "" }, { ...task, label: "trusted:approval" }]) assert.throws(() => parseTaskAuthorization(bad), TypeError);
});

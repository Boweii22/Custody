import test from "node:test";
import assert from "node:assert/strict";
import { labeled } from "../lib/kernel.ts";
import { createDemoContext, policies } from "../lib/fixtures.ts";
import { createToolkitRefundBridge } from "../lib/toolkit.ts";
import type { PaymentPlan } from "../lib/kernel.ts";
import type { ToolkitBridgeDependencies, ToolkitExecutionClaim, ToolkitOptions, ToolkitRefundPayload } from "../lib/toolkit.ts";

const capture = "ABC12345678901234"; // Synthetic; these tests never construct a network SDK.
function fixture() {
  const context = createDemoContext();
  context.orders[0].captureId = capture;
  const plan: PaymentPlan = {
    kind: "refund", targetId: context.orders[0].id, sourceId: "refund-request-1",
    args: {
      captureId: labeled(capture, "trusted:paypal", "original capture"),
      amountCents: labeled(89, "tainted:email", "request"),
      currency: labeled("USD", "tainted:email", "request"),
      arbitraryTool: labeled("send_money", "tainted:model", "model"),
      requestedCapture: labeled("ATTACKER-CAPTURE", "tainted:email", "request"),
    },
  };
  const options: ToolkitOptions[] = [];
  const payloads: ToolkitRefundPayload[] = [];
  const claims: ToolkitExecutionClaim[] = [];
  const claimed = new Set<string>();
  const deps: ToolkitBridgeDependencies = {
    clientId: "synthetic-client", clientSecret: "synthetic-secret",
    loadAuthority: async () => ({ policy: policies.find(p => p.kind === "refund")!, context }),
    claimExecution: async claim => {
      claims.push(claim);
      if (claimed.has(claim.idempotencyKey)) return false;
      claimed.add(claim.idempotencyKey);
      return true;
    },
    createToolkit: config => {
      options.push(config);
      return { getTools: () => ({ create_refund: { execute: async (payload: ToolkitRefundPayload) => {
        payloads.push(payload);
        return { id: "synthetic-refund-response", status: "PENDING" };
      } } }) };
    },
  };
  return { plan, context, deps, options, payloads, claims };
}

test("Toolkit bridge sends only a fresh kernel-resolved capture and exact USD amount", async () => {
  const f = fixture();
  const result = await createToolkitRefundBridge(f.deps).execute(f.plan);
  assert.equal(result.status, "submitted");
  assert.deepEqual(f.payloads, [{ capture_id: capture, amount: { currency_code: "USD", value: "0.89" } }]);
  assert.deepEqual(f.options[0].configuration.actions, { payments: { createRefund: true } });
  assert.equal(f.options[0].configuration.context.sandbox, true);
  assert.match(f.options[0].configuration.context.request_id, /^custody-[a-f0-9]{30}$/);
  assert.equal(f.claims[0].requestId, f.options[0].configuration.context.request_id);
  assert.ok(!JSON.stringify(f.payloads).includes("ATTACKER"));
  assert.ok(!JSON.stringify(f.payloads).includes("send_money"));
});

test("tainted and forged capture labels, alternate receivers and over-cap plans never invoke SDK", async () => {
  for (const mutate of [
    (p: PaymentPlan) => { p.args.captureId = labeled(capture, "tainted:email", "email"); },
    (p: PaymentPlan) => { p.args.captureId = labeled("ATTACKER-CAPTURE", "trusted:paypal", "forged"); },
    (p: PaymentPlan) => { p.args.receiver = labeled("attacker@example.test", "trusted:vendor_book", "forged"); },
    (p: PaymentPlan) => { p.args.amountCents.value = 25001; },
  ]) {
    const f = fixture();
    mutate(f.plan);
    assert.equal((await createToolkitRefundBridge(f.deps).execute(f.plan)).status, "denied");
    assert.equal(f.options.length, 0);
    assert.equal(f.claims.length, 0);
    assert.equal(f.payloads.length, 0);
  }
});

test("unsupported playbooks cannot select arbitrary Toolkit tools", async () => {
  const f = fixture();
  f.plan.kind = "pay_invoice";
  assert.equal((await createToolkitRefundBridge(f.deps).execute(f.plan)).status, "unsupported");
  assert.equal(f.options.length, 0);
});

test("demo captures and expanded SDK tool registries fail closed before claiming or execution", async () => {
  const f = fixture();
  f.context.orders[0].captureId = "DEMO-CAPTURE-1048";
  f.plan.args.captureId.value = "DEMO-CAPTURE-1048";
  await assert.rejects(createToolkitRefundBridge(f.deps).execute(f.plan), /Demo capture IDs/);
  assert.equal(f.options.length, 0);
  f.context.orders[0].captureId = capture;
  f.plan.args.captureId.value = capture;
  f.deps.createToolkit = () => ({ getTools: () => ({ create_refund: { execute: () => undefined }, pay_order: {} }) });
  await assert.rejects(createToolkitRefundBridge(f.deps).execute(f.plan), /exactly one executable/);
  assert.equal(f.claims.length, 0);
});

test("the host ledger claim prevents duplicate invocations and request IDs remain stable", async () => {
  const f = fixture();
  const bridge = createToolkitRefundBridge(f.deps);
  const results = await Promise.all([bridge.execute(f.plan), bridge.execute(f.plan)]);
  assert.deepEqual(results.map(r => r.status).sort(), ["already_claimed", "submitted"]);
  assert.equal(f.payloads.length, 1);
  assert.equal(f.options[0].configuration.context.request_id, f.options[1].configuration.context.request_id);
});

test("caller mutation while authority is loading cannot change the evaluated plan", async () => {
  const f = fixture();
  const promise = createToolkitRefundBridge(f.deps).execute(f.plan);
  f.plan.args.captureId.value = "ATTACKER-CAPTURE";
  f.plan.args.amountCents.value = 25000;
  assert.equal((await promise).status, "submitted");
  assert.equal(f.payloads[0].capture_id, capture);
  assert.equal(f.payloads[0].amount.value, "0.89");
});

test("transport errors are propagated without retrying or releasing the host claim", async () => {
  const f = fixture();
  let calls = 0;
  f.deps.createToolkit = () => ({ getTools: () => ({ create_refund: { execute: async () => {
    calls++;
    throw new Error("ambiguous timeout");
  } } }) });
  const bridge = createToolkitRefundBridge(f.deps);
  await assert.rejects(bridge.execute(f.plan), /ambiguous timeout/);
  assert.equal((await bridge.execute(f.plan)).status, "already_claimed");
  assert.equal(calls, 1);
});

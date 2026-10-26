import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppState } from "../app/ui-types.ts";
import { hasExtractorCredentials, initialPolicies, missingExecutionConfiguration, operatingMode } from "../lib/server/configuration.ts";

const fakeEnvironment: Record<string, unknown> = {};
(globalThis as typeof globalThis & { custodyTestEnvironment: unknown }).custodyTestEnvironment = fakeEnvironment;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = globalThis.custodyTestEnvironment", shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (url.protocol === "file:" && existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

class TestDatabase {
  rows = new Map<string, { payload: string; version: number }>();
  prepare(sql: string) {
    let values: unknown[] = [];
    const db = this;
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async first() {
        if (sql.includes("custody_rate_limits")) return { count: 1 };
        if (sql.includes("SELECT 1")) return { healthy: 1 };
        const row = db.rows.get(String(values[0]));
        return row ? { id: values[0], ...row } : null;
      },
      async run() {
        if (sql.startsWith("INSERT")) {
          if (!db.rows.has(String(values[0]))) db.rows.set(String(values[0]), { payload: String(values[1]), version: 0 });
          return { meta: { changes: 1 } };
        }
        const row = db.rows.get(String(values[2]));
        if (!row || row.version !== values[3]) return { meta: { changes: 0 } };
        row.payload = String(values[0]); row.version++;
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}
const hosted = { id: "seller-123", name: "Seller", email: "seller@merchant.com", local: false };
const configured = { CUSTODY_RAIL: "sandbox", CUSTODY_SELLER_ID: hosted.id, PAYPAL_CLIENT_ID: "test-client", PAYPAL_CLIENT_SECRET: "test-secret", EXTRACTOR_URL: "https://model-provider.com/v1/chat/completions", EXTRACTOR_KEY: "test-model-key", EXTRACTOR_MODEL: "test-model" };
function reset() { for (const key of Object.keys(fakeEnvironment)) delete fakeEnvironment[key]; fakeEnvironment.DB = new TestDatabase(); }

test("real mode defaults fail closed and policy templates cannot execute", () => {
  assert.equal(operatingMode({}), "unconfigured");
  for (const value of ["demo", "production", "live", "", "SANDBOX"]) assert.equal(operatingMode({ CUSTODY_RAIL: value }), "unconfigured");
  assert.equal(operatingMode({ CUSTODY_RAIL: "sandbox" }), "sandbox");
  assert.equal(initialPolicies().length, 4);
  assert.ok(initialPolicies().every(policy => policy.enabled === false));
  assert.ok(missingExecutionConfiguration({}).length >= 4);
  assert.equal(hasExtractorCredentials({ EXTRACTOR_URL: "http://localhost:1234", EXTRACTOR_KEY: "key", EXTRACTOR_MODEL: "model" }), false);
});

test("operational state never loads a historical fictional ledger", async () => {
  reset();
  const database = fakeEnvironment.DB as TestDatabase;
  database.rows.set("seller-ledger-v1", { payload: JSON.stringify({ decisions: [{ id: "fictional" }] }), version: 0 });
  const { appState } = await import("../lib/server/service.ts");
  const state = await appState(hosted);
  assert.deepEqual(state.decisions, []); assert.deepEqual(state.vendors, []); assert.deepEqual(state.orders, []);
  assert.equal(state.mode, "unconfigured"); assert.equal(state.extractor, "unconfigured");
  assert.equal(state.readiness.ready, false); assert.equal(state.stats.stolenCents, null);
  assert.ok(state.policies.every(policy => !(policy as {enabled: boolean}).enabled));
  assert.equal(database.rows.get("seller-ledger-v1")?.payload, JSON.stringify({ decisions: [{ id: "fictional" }] }));
});

test("setup remains readable, but local and unconfigured callers cannot call the sandbox", async () => {
  reset();
  const { identity, requireSandboxSeller, HttpError } = await import("../lib/server/runtime.ts");
  const local = await identity(new Request("http://localhost:4381/api/state"));
  assert.equal(local.local, true);
  assert.throws(() => requireSandboxSeller(hosted, true), (error: unknown) => error instanceof HttpError && error.status === 503);
  Object.assign(fakeEnvironment, configured);
  assert.throws(() => requireSandboxSeller({ ...hosted, local: true }, true), (error: unknown) => error instanceof HttpError && error.status === 403);
  assert.doesNotThrow(() => requireSandboxSeller(hosted, true));
  const { processMessage } = await import("../lib/server/service.ts");
  await assert.rejects(processMessage({ arena: true, text: "attempt" }, hosted), (error: unknown) => error instanceof HttpError && error.status === 409);
});

test("model failure never silently produces a parsed or simulated decision", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { extractQuarantined } = await import("../lib/server/extraction.ts");
  const { HttpError } = await import("../lib/server/runtime.ts");
  try {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(extractQuarantined({ body: "Vendor: Real vendor\nAmount: $10.00 USD" }), (error: unknown) => error instanceof HttpError && error.status === 502);
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ kind: "pay_invoice", vendor: "Real vendor", customer: "", invoiceNumber: "INV1", orderId: "", disputeId: "", currency: "USD", requestedReceiver: null, amountCents: 1000 }) } }] });
    const extraction = await extractQuarantined({ body: "Vendor: Real vendor\nAmount: $10.00 USD" });
    assert.equal(extraction.method, "model"); assert.equal(extraction.vendor.value, "Real vendor");
    assert.equal(extraction.vendor.label, "tainted:model"); assert.equal(extraction.amountCents.label, "tainted:model");
    delete fakeEnvironment.EXTRACTOR_KEY;
    await assert.rejects(extractQuarantined({ body: "some request" }), (error: unknown) => error instanceof HttpError && error.status === 503);
  } finally { globalThis.fetch = originalFetch; }
});

test("real connection verification records successful responses, and credential changes invalidate them", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { appState, verifyConnections } = await import("../lib/server/service.ts");
  const claims = { kind: "pay_invoice", vendor: "", customer: "", invoiceNumber: "", orderId: "", disputeId: "", currency: "", requestedReceiver: null, amountCents: null };
  try {
    globalThis.fetch = async url => String(url).includes("oauth2") ? Response.json({ access_token: "test-token", expires_in: 3600 }) : Response.json({ choices: [{ message: { content: JSON.stringify(claims) } }] });
    assert.equal((await appState(hosted)).readiness.ready, false);
    const verified = await verifyConnections(hosted);
    assert.equal(verified.state.readiness.ready, true);
    assert.deepEqual(verified.state.decisions, []);
    assert.ok(verified.state.readiness.checks.find(value => value.id === "policies")?.status === "missing");
    fakeEnvironment.EXTRACTOR_KEY = "changed-test-key";
    assert.equal((await appState(hosted)).readiness.ready, false);
    globalThis.fetch = async url => String(url).includes("oauth2") ? Response.json({ access_token: "test-token", expires_in: 3600 }) : new Response("failed", { status: 503 });
    await assert.rejects(verifyConnections(hosted));
    const state = await appState(hosted);
    assert.equal(state.readiness.checks.find(value => value.id === "paypal")?.status, "ready");
    assert.equal(state.readiness.checks.find(value => value.id === "extractor")?.status, "unverified");
    assert.deepEqual(state.decisions, []);
  } finally { globalThis.fetch = originalFetch; }
});

test("PayPal-only verification works without a model and retains request authentication and scope validation", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  delete fakeEnvironment.EXTRACTOR_URL; delete fakeEnvironment.EXTRACTOR_KEY; delete fakeEnvironment.EXTRACTOR_MODEL;
  const originalFetch = globalThis.fetch;
  const { POST } = await import("../app/api/connections/verify/route.ts");
  let oauthCalls = 0;
  const request = (body: unknown, options: { origin?: string; authenticate?: boolean; local?: boolean } = {}) => {
    const origin = options.local ? "http://localhost:4381" : "https://custody.owner.example";
    return new Request(`${origin}/api/connections/verify`, { method: "POST", headers: {
      "Content-Type": "application/json", Origin: options.origin ?? origin,
      ...(options.authenticate === false ? {} : { "oai-authenticated-user-id": hosted.id, "oai-authenticated-user-email": hosted.email }),
    }, body: JSON.stringify(body) });
  };
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://api-m.sandbox.paypal.com/v1/oauth2/token");
      assert.equal(options?.method, "POST");
      oauthCalls++;
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    };
    const response = await POST(request({ scope: "paypal" }));
    assert.equal(response.status, 200);
    const { state } = await response.json() as { state: AppState };
    assert.equal(oauthCalls, 1);
    assert.equal(state.readiness.checks.find(value => value.id === "paypal")?.status, "ready");
    assert.equal(state.readiness.checks.find(value => value.id === "extractor")?.status, "missing");
    assert.equal(state.readiness.ready, false);
    assert.deepEqual(state.decisions, []);
    assert.equal((await POST(request({}))).status, 503);
    assert.equal((await POST(request({ scope: "all" }))).status, 503);
    for (const scope of ["model", "sandbox", null, false, {}, []]) assert.equal((await POST(request({ scope }))).status, 400);
    assert.equal((await POST(request({ scope: "paypal" }, { authenticate: false }))).status, 401);
    assert.equal((await POST(request({ scope: "paypal" }, { origin: "https://other.example" }))).status, 403);
    assert.equal((await POST(request({ scope: "paypal" }, { local: true }))).status, 403);
    assert.equal(oauthCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("PayPal-only rechecks preserve an existing model verification and invalidate only PayPal on OAuth failure", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { appState, verifyConnections } = await import("../lib/server/service.ts");
  const { readState } = await import("../lib/server/store.ts");
  const claims = { kind: "pay_invoice", vendor: "", customer: "", invoiceNumber: "", orderId: "", disputeId: "", currency: "", requestedReceiver: null, amountCents: null };
  try {
    globalThis.fetch = async url => String(url).includes("oauth2") ? Response.json({ access_token: "test-token", expires_in: 3600 }) : Response.json({ choices: [{ message: { content: JSON.stringify(claims) } }] });
    await verifyConnections(hosted);
    const modelVerification = (await readState()).state.connectionVerifications?.extractor;
    let calls = 0;
    globalThis.fetch = async url => {
      assert.ok(String(url).endsWith("/v1/oauth2/token")); calls++;
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    };
    assert.equal((await verifyConnections(hosted, false)).state.readiness.ready, true);
    assert.equal(calls, 1);
    assert.deepEqual((await readState()).state.connectionVerifications?.extractor, modelVerification);
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(verifyConnections(hosted, false));
    const state = await appState(hosted);
    assert.equal(state.readiness.ready, false);
    assert.equal(state.readiness.checks.find(value => value.id === "paypal")?.status, "unverified");
    assert.equal(state.readiness.checks.find(value => value.id === "extractor")?.status, "ready");
    assert.deepEqual((await readState()).state.connectionVerifications?.extractor, modelVerification);
    assert.deepEqual(state.decisions, []);
  } finally { globalThis.fetch = originalFetch; }
});

test("premature buyer capture does not poison its durable checkout reservation", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { checkoutOperation, ensureLedger } = await import("../lib/server/service.ts");
  const { mutateState, readState } = await import("../lib/server/store.ts");
  const { HttpError } = await import("../lib/server/runtime.ts");
  await ensureLedger();
  await mutateState(state => { state.paypalOperations = [{ id: "create-1", kind: "create_order", key: "create", actor: hosted.id, status: "completed", createdAt: new Date().toISOString(), orderId: "ORDER123", amountCents: 1000 }]; });
  let captures = 0;
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("oauth2")) return Response.json({ access_token: "token", expires_in: 3600 });
      if (options?.method === "POST") captures++;
      return Response.json({ id: "ORDER123", status: "CREATED", purchase_units: [{ amount: { value: "10.00", currency_code: "USD" } }] });
    };
    await assert.rejects(checkoutOperation({ action: "capture", orderId: "ORDER123", requestId: "capture-1" }, hosted, "https://seller.example"), (error: unknown) => error instanceof HttpError && error.status === 409);
    assert.equal(captures, 0);
    assert.equal((await readState()).state.paypalOperations?.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("completed refunds remain reserved until the exact refund is present in a fresh provider snapshot", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { ensureLedger, processMessage } = await import("../lib/server/service.ts");
  const { mutateState } = await import("../lib/server/store.ts");
  await ensureLedger();
  await mutateState(state => {
    const policy = state.policies.find(value => (value as {kind: string}).kind === "refund") as {enabled: boolean}; policy.enabled = true;
    state.orders = [{ id: "ORDER123", customerId: "buyer", customerName: "Buyer", captureId: "CAPTURE123", capturedCents: 10000, refundedCents: 0, currency: "USD", capturedAt: new Date().toISOString(), paymentStatus: "COMPLETED", description: "Actual provider record in test" }];
  });
  const claims = { kind: "refund", vendor: "", customer: "", invoiceNumber: "", orderId: "ORDER123", disputeId: "", currency: "USD", requestedReceiver: null, amountCents: 6000 };
  let refundCalls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("oauth2")) return Response.json({ access_token: "test-token", expires_in: 3600 });
      if (String(url).includes("model-provider")) return Response.json({ choices: [{ message: { content: JSON.stringify(claims) } }] });
      if (String(url).endsWith("/refund") && options?.method === "POST") { refundCalls++; return Response.json({ id: "REFUND123", status: "COMPLETED", amount: { value: "60.00", currency_code: "USD" } }); }
      // Deliberately stale order snapshot after the successful refund.
      return Response.json({ id: "ORDER123", purchase_units: [{ payments: { captures: [{ id: "CAPTURE123", status: "COMPLETED", create_time: new Date().toISOString(), amount: { value: "100.00", currency_code: "USD" } }] } }] });
    };
    const first = await processMessage({ text: "Refund 60 dollars for ORDER123" }, hosted);
    assert.equal(first.decision.status, "refunded");
    assert.equal(first.decision.refundBalanceConfirmed, false);
    const second = await processMessage({ text: "Another refund 60 dollars for ORDER123" }, hosted);
    assert.notEqual(second.decision.verdict, "allow");
    assert.equal(refundCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

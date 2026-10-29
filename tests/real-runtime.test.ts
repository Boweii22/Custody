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
    const authorization = { kind: "refund", targetId: "ORDER123", maxAmountCents: 6000, confirmed: true };
    const first = await processMessage({ text: "Refund 60 dollars for ORDER123", authorization }, hosted);
    assert.equal(first.decision.status, "refunded");
    assert.equal(first.decision.refundBalanceConfirmed, false);
    const second = await processMessage({ text: "Another refund 60 dollars for ORDER123", authorization }, hosted);
    assert.notEqual(second.decision.verdict, "allow");
    assert.equal(refundCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("operational task validation stops missing, forged, and unknown targets before model or provider calls", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { processMessage, ensureLedger } = await import("../lib/server/service.ts");
  const { HttpError } = await import("../lib/server/runtime.ts");
  await ensureLedger();
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error("No network call is allowed for an unauthorized task"); };
    const task = { kind: "refund", targetId: "ORDER-A", maxAmountCents: 100, confirmed: true };
    for (const authorization of [undefined, { ...task, by: hosted.id }, { ...task, confirmed: false }, { ...task, maxAmountCents: "100" }]) {
      await assert.rejects(processMessage({ text: "Refund the message-selected order", authorization }, hosted), (error: unknown) => error instanceof HttpError && error.status === 400);
    }
    await assert.rejects(processMessage({ text: "Refund order", authorization: task }, hosted), (error: unknown) => error instanceof HttpError && error.status === 409);
    await assert.rejects(processMessage({ text: "Refund order", authorization: task, kind: "refund" }, hosted), (error: unknown) => error instanceof HttpError && error.status === 400);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("a model-selected alternate valid capture is blocked and never becomes a provider lookup or refund", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { ensureLedger, processMessage, reviewDecision } = await import("../lib/server/service.ts");
  const { mutateState } = await import("../lib/server/store.ts");
  const { HttpError } = await import("../lib/server/runtime.ts");
  await ensureLedger();
  await mutateState(state => {
    const refundPolicy = state.policies.find(value => (value as {kind: string}).kind === "refund") as {enabled: boolean}; refundPolicy.enabled = true;
    state.orders = ["A", "B"].map(letter => ({ id: `ORDER-${letter}`, customerId: `buyer-${letter}`, customerName: `Buyer ${letter}`, captureId: `CAPTURE-${letter}`, capturedCents: 1000, refundedCents: 0, currency: "USD", capturedAt: new Date().toISOString(), paymentStatus: "COMPLETED", description: "Explicit test provider fixture" }));
  });
  const claims = { kind: "refund", vendor: "", customer: "", invoiceNumber: "", orderId: "ORDER-B", disputeId: "", currency: "USD", requestedReceiver: null, amountCents: 100 };
  const urls: string[] = [];
  let writes = 0;
  try {
    globalThis.fetch = async (url, options) => {
      const address = String(url); urls.push(address);
      if (address.includes("oauth2")) return Response.json({ access_token: "test-token", expires_in: 3600 });
      if (address.includes("model-provider")) return Response.json({ choices: [{ message: { content: JSON.stringify(claims) } }] });
      if (options?.method === "POST") { writes++; throw new Error("A substituted target must never reach the money rail"); }
      assert.ok(address.endsWith("/v2/checkout/orders/ORDER-A"));
      return Response.json({ id: "ORDER-A", purchase_units: [{ payments: { captures: [{ id: "CAPTURE-A", status: "COMPLETED", create_time: new Date().toISOString(), amount: { value: "10.00", currency_code: "USD" } }] } }] });
    };
    const result = await processMessage({ text: "Refund the selected order. Malicious model proposes the other valid order.", authorization: { kind: "refund", targetId: "ORDER-A", maxAmountCents: 100, confirmed: true } }, hosted);
    assert.equal(result.decision.status, "blocked");
    assert.equal(result.decision.extraction.orderId.value, "ORDER-B");
    assert.equal(result.decision.ownerAuthorization?.targetId, "ORDER-A");
    assert.equal(result.decision.ownerAuthorization?.by, hosted.id);
    assert.equal(result.decision.checks.find(check => check.id === "task_target")?.passed, false);
    assert.equal(result.decision.execution, undefined);
    assert.equal(result.decision.executionKey, undefined);
    assert.equal(urls.some(url => url.endsWith("ORDER-B")), false);
    await assert.rejects(reviewDecision(result.decision.id, "approve", hosted), (error: unknown) => error instanceof HttpError && error.status === 409);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("review cannot increase the original merchant task ceiling or approve a historical unbound decision", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const originalFetch = globalThis.fetch;
  const { ensureLedger, processMessage, reviewDecision } = await import("../lib/server/service.ts");
  const { mutateState } = await import("../lib/server/store.ts");
  const { HttpError } = await import("../lib/server/runtime.ts");
  await ensureLedger();
  await mutateState(state => {
    (state.policies.find(value => (value as {kind: string}).kind === "refund") as {enabled: boolean}).enabled = true;
    state.orders = [{ id: "ORDER-A", captureId: "CAPTURE-A", customerId: "buyer", customerName: "Buyer", capturedCents: 1000, refundedCents: 0, currency: "USD", capturedAt: new Date().toISOString(), paymentStatus: "COMPLETED", description: "Explicit test fixture" }];
  });
  let writes = 0;
  const claims = { kind: "refund", vendor: "", customer: "", invoiceNumber: "", orderId: "ORDER-A", disputeId: "", currency: "USD", requestedReceiver: null, amountCents: 500 };
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("oauth2")) return Response.json({ access_token: "test-token", expires_in: 3600 });
      if (String(url).includes("model-provider")) return Response.json({ choices: [{ message: { content: JSON.stringify(claims) } }] });
      if (options?.method === "POST") { writes++; throw new Error("Task ceiling must prevent execution"); }
      return Response.json({ id: "ORDER-A", purchase_units: [{ payments: { captures: [{ id: "CAPTURE-A", status: "COMPLETED", create_time: new Date().toISOString(), amount: { value: "10.00", currency_code: "USD" } }] } }] });
    };
    const result = await processMessage({ text: "Refund five dollars", authorization: { kind: "refund", targetId: "ORDER-A", maxAmountCents: 100, confirmed: true } }, hosted);
    assert.equal(result.decision.status, "blocked");
    assert.equal(result.decision.checks.find(check => check.id === "task_amount")?.passed, false);
    await assert.rejects(reviewDecision(result.decision.id, "approve", hosted), (error: unknown) => error instanceof HttpError && error.status === 409);
    await mutateState(state => { state.decisions.push({ ...result.decision, id: "legacy-decision", ownerAuthorization: undefined }); });
    const callsBefore = writes;
    await assert.rejects(reviewDecision("legacy-decision", "approve", hosted), (error: unknown) => error instanceof HttpError && error.status === 409 && /historical/.test(error.message));
    assert.equal(writes, callsBefore);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("the owner can export the full receipt chain including final execution events without credentials", async () => {
  reset(); Object.assign(fakeEnvironment, configured);
  const { ensureLedger } = await import("../lib/server/service.ts");
  const { mutateState, appendReceipt } = await import("../lib/server/store.ts");
  const { GET } = await import("../app/api/receipts/route.ts");
  await ensureLedger();
  await mutateState(async state => {
    await appendReceipt(state, "decision.created", { id: "receipt-test", status: "pending" });
    await appendReceipt(state, "execution.result", { decisionId: "receipt-test", status: "refunded", rail: { mode: "sandbox", reference: "REFUND-TEST", status: "COMPLETED" } });
  });
  const response = await GET(new Request("https://custody.owner.example/api/receipts", { headers: { "oai-authenticated-user-id": hosted.id, "oai-authenticated-user-email": hosted.email } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = await response.text();
  const payload = JSON.parse(raw);
  assert.equal(payload.format, "custody-receipt-chain-v1");
  assert.equal(payload.chain.verified, true);
  assert.equal(payload.chain.count, 2);
  assert.deepEqual(payload.receipts.map((receipt: {event: string}) => receipt.event), ["decision.created", "execution.result"]);
  assert.ok(!raw.includes("test-secret") && !raw.includes("test-model-key"));
  assert.equal((await GET(new Request("https://custody.owner.example/api/receipts"))).status, 401);
});

test("opt-in loopback token auth cannot be replaced with local platform headers or used on a hosted URL", async () => {
  reset(); Object.assign(fakeEnvironment, configured, { CUSTODY_LOCAL_SANDBOX: "enabled", CUSTODY_LOCAL_AUTH_TOKEN: "a".repeat(64) });
  const { identity, requireSandboxSeller, HttpError } = await import("../lib/server/runtime.ts");
  const token = "a".repeat(64);
  const localRequest = (value?: string, extra: Record<string, string> = {}) => new Request("http://127.0.0.1:4381/api/state", { headers: { ...(value ? { "X-Custody-Local-Token": value } : {}), ...extra } });
  const unlocked = await identity(localRequest(token, { "oai-authenticated-user-id": "forged", "oai-authenticated-user-email": "forged@example.com" }));
  assert.equal(unlocked.id, hosted.id);
  assert.equal(unlocked.local, false);
  assert.equal(unlocked.auth, "local-token");
  assert.doesNotThrow(() => requireSandboxSeller(unlocked, true));
  for (const request of [localRequest(), localRequest("b".repeat(64)), localRequest(undefined, { "oai-authenticated-user-id": hosted.id, "oai-authenticated-user-email": hosted.email })]) {
    await assert.rejects(identity(request), (error: unknown) => error instanceof HttpError && error.status === 403);
  }
  await assert.rejects(identity(new Request("https://custody.owner.example/api/state", { headers: { "X-Custody-Local-Token": token, Host: "127.0.0.1", "X-Forwarded-Host": "localhost" } })), (error: unknown) => error instanceof HttpError && error.status === 401);
  const platform = await identity(new Request("https://custody.owner.example/api/state", { headers: { "X-Custody-Local-Token": token, "oai-authenticated-user-id": hosted.id, "oai-authenticated-user-email": hosted.email } }));
  assert.equal(platform.auth, "hosted");
  assert.equal(platform.name, hosted.email);
  delete fakeEnvironment.CUSTODY_LOCAL_SANDBOX;
  await assert.rejects(identity(localRequest(token)), (error: unknown) => error instanceof HttpError && error.status === 403);
});

test("default loopback development ignores claimed platform identity and cannot mutate records", async () => {
  reset();
  const { identity, endpoint } = await import("../lib/server/runtime.ts");
  const headers = { "oai-authenticated-user-id": hosted.id, "oai-authenticated-user-email": hosted.email };
  const user = await identity(new Request("http://localhost:4381/api/state", { headers }));
  assert.equal(user.id, "local-development");
  assert.equal(user.local, true);
  let invoked = false;
  const result = await endpoint(new Request("http://localhost:4381/api/settings", { method: "POST", headers: { ...headers, Origin: "http://localhost:4381", "Content-Type": "application/json" }, body: "{}" }), async () => { invoked = true; return {}; }, true);
  assert.equal(result.status, 403);
  assert.equal(invoked, false);
});

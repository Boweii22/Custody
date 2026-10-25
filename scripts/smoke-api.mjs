import assert from 'node:assert/strict';

// Business-data-free verification of an unconfigured local app.
// Never configures recipients, enables policies or submits a payment.
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4381').origin;
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Only a local development server is permitted.');
async function request(path, body, includeOrigin = true) {
  const response = await fetch(origin + path, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...(includeOrigin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, data: await response.json() };
}
const checks = [];
const initial = await request('/api/state');
assert.equal(initial.status, 200);
const state = initial.data;
assert.ok(['sandbox', 'unconfigured'].includes(state.mode));
assert.equal(state.readiness.ready, false, 'Requires an unconfigured local instance.');
assert.equal(state.decisions.length, 0);
assert.equal(state.vendors.length, 0);
assert.equal(state.customers.length, 0);
assert.equal(state.orders.length, 0);
assert.ok(state.policies.every(policy => policy.enabled === false));
assert.equal(state.chain.verified, true);
checks.push('empty real ledger with no seeded counterparties, records or enabled policies');

for (const [path, body] of [
  ['/api/process', { subject: 'Unconfigured boundary check', text: 'No provider call may execute without a configured seller.' }],
  ['/api/process', { arena: true, text: 'No simulated payment may execute.' }],
  ['/api/paypal/orders', { action: 'create', amountCents: 1, requestId: 'unconfigured-boundary-check' }],
  ['/api/paypal/records', { orderId: 'UNCONFIGURED-BOUNDARY-CHECK' }],
]) {
  const response = await request(path, body);
  assert.ok([401, 403, 409, 503].includes(response.status), `${path} must fail closed, received ${response.status}`);
  assert.equal(typeof response.data.error, 'string');
}
checks.push('model, sandbox creation/import and simulated arena all fail closed');
const csrf = await request('/api/process', { text: 'Origin boundary check' }, false);
assert.equal(csrf.status, 403);
checks.push('mutations require same-origin authorization');
const final = (await request('/api/state')).data;
assert.deepEqual(final.decisions, state.decisions);
assert.equal(final.chain.count, state.chain.count);
assert.equal(final.chain.head, state.chain.head);
assert.equal(final.chain.verified, true);
checks.push('rejected operations create no business records or execution receipts');
console.log(JSON.stringify({ ok: true, evidence: 'local_unconfigured_boundaries_only', providerVerified: false, checks }, null, 2));

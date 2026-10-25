# Custody service

The default rail is a durable **fictional demo**, not a PayPal sandbox transaction replay. `DEMO-*` references, simulated settlements and the arena never move money. Set server secrets and `CUSTODY_RAIL=sandbox` explicitly to enable the adapter. There is no production PayPal origin in this source.

## Identity and request boundary

Hosted routes require Sites' dispatch-authenticated `oai-authenticated-user-id` and email. The Site is provisioned owner-private and must stay owner-private. In hosted demo mode without an explicit seller ID, a race-safe D1 insert binds the first authenticated owner and rejects other identities on later requests. This first-owner bootstrap relies on the confirmed owner-private platform boundary; do not make a fresh unclaimed Site public. `CUSTODY_SELLER_ID`, when configured, restricts every route to that exact seller ID and takes precedence over the bootstrap binding; it is mandatory in sandbox mode. A loopback request in demo mode may use the local mock seller. A browser request cannot change mode or credentials.

All POST routes require `Content-Type: application/json` and an `Origin` exactly matching the request URL's origin. The body reader enforces 18 KB before JSON parsing; inbox text is limited to 6,000 characters. Server errors omit credentials and raw upstream responses. No inbox HTML is evaluated or rendered by the service.

The private seller API is not a public multi-user API. The arena is a private, isolated red-team simulation inside this application; public anonymous access, email ingestion and public scoring are not implemented.

## Endpoints

### GET /api/state

Initializes the fictional seller dataset on first access with `INSERT OR IGNORE`, then returns:

```ts
{
  mode: 'demo' | 'sandbox',
  extractor: 'rule-demo' | 'model',
  identity: { id, name, email, local },
  vendors, customers, orders, disputes, policies, paypalOperations,
  decisions: StoredDecision[],
  arena: StoredDecision[],
  stats: {
    processed, protectedCents, held, blocked, attempts,
    stolenCents: number, arenaSimulated: true
  },
  chain: { verified, count, head },
  capabilities: {
    sandboxConfigured, extractorConfigured,
    disputes: true, arenaMoneyRail: false
  }
}
```

`protectedCents` sums requested amounts on held/blocked records and on records where a requested destination was discarded. It is a demo activity metric, not a measured claim of actual money saved. `stolenCents` sums positive simulated arena execution amounts when a protected receiver, capture, recipient or dispute reference differs from, or lacks, its authoritative decision-time provenance. Later vendor-book edits do not change those historical snapshots. This is a simulated execution-consistency metric, not a PayPal balance, verified theft amount or security proof. The arena still has no money rail.

### POST /api/process

```json
{
  "subject": "October supplies",
  "text": "Vendor: Acme Packaging\nInvoice: CUSTOM-001\nAmount: $480.00 USD\nPlease pay our usual account.",
  "kind": "pay_invoice",
  "arena": false
}
```

`kind` is optional and chooses only one standing playbook: `pay_invoice`, `refund`, `send_invoice` or `dispute`. It cannot specify a trusted receiver, capture, recipient, policy or tool. The optional `arena` flag always forces the fictional rail even when the seller's server rail is sandbox.

The response is `{decision: StoredDecision, state: AppState}`. A stored decision includes:

```ts
{
  id, createdAt, subject, text, kind, arena, mode,
  verdict: 'allow' | 'hold' | 'block',
  status: 'paid' | 'refunded' | 'invoiced' | 'evidence' |
          'held' | 'blocked' | 'rejected' | 'pending' | 'failed',
  amountCents, currency, counterparty,
  extraction: { method: 'rule-demo' | 'model', /* all claims labeled */ },
  plan, tool, reasons, checks, provenance,
  execution?: { tool, args, idempotencyKey },
  rail?: { mode, reference, status },
  receipt: { index, at, previousHash, hash, event, data },
  approval?: { by, at, action, diff }
}
```

An attacker can request a different destination while the legitimate action still succeeds safely. For example, an Acme invoice containing `billing-update@redteam.example` resolves through the vendor book to `payments@acme.example`; the attacker's address remains a tainted `requestedReceiver` and is absent from `execution.args.receiver`. `verdict: allow` in this case authorizes the reconstructed legitimate payment, not the hostile instruction.

In sandbox mode, Payouts' `PENDING` response stays `status: pending`. Only an upstream completed refund or successful synchronous operation is displayed as completed. No pending payout is described as settled. Failed/uncertain actions remain reserved and require manual PayPal reconciliation; the application does not automatically resubmit them.

Rate limits: hosted seller processing 60/minute; arena 20/minute per incoming IP. Loopback demo allows 150 processing and 120 arena requests/minute for the benchmark. The global model breaker permits at most 300 extractor calls per UTC day. These are durable fixed buckets in D1.

### POST /api/decisions/:id

```json
{"action":"approve"}
```

`reject` records the authenticated actor and a receipt. `approve` re-resolves and re-evaluates the action against current authoritative records. It allows a one-time amount-cap/vendor-allowance exception for an existing trusted destination and logs the before/after values in `approval.diff`. It does not alter the standing policy or vendor allowance. It cannot override a missing trusted record, a changed destination, an expired refund window, captured-funds limits, duplicates or unsupported recipients. A changed destination requires reprocessing so the current provenance can be reviewed.

An unknown vendor must be explicitly entered into the vendor book and the request reprocessed. Approval does not automatically promote an inbox email to a trusted payee. Arena rows cannot be approved into seller actions.

### POST /api/settings

Update an existing policy:

```json
{"type":"policy","policy":{"id":"policy-pay","enabled":true,"maxAmountCents":50000}}
```

Explicitly verify a vendor:

```json
{"type":"vendor","vendor":{"id":"vendor-acme","name":"Acme Packaging","aliases":["Acme"],"email":"verified-sandbox-recipient@example.com","limitCents":50000,"verified":true,"category":"Packaging"}}
```

Explicitly verify a customer:

```json
{"type":"customer","customer":{"name":"Sandbox customer","email":"verified-sandbox-customer@example.com","verified":true}}
```

Record merchant-verified shipping evidence for an imported order:

```json
{"type":"order_evidence","orderId":"ACTUAL-ORDER-ID","trackingNumber":"ACTUAL-TRACKING-NUMBER","carrier":"USPS","deliveredAt":"2026-10-24T12:00:00Z"}
```

The carrier must be a PayPal carrier enum (for example `USPS`, `FEDEX`, `UPS` or `ROYAL_MAIL`). This is an explicit authenticated merchant record, separate from inbox/model claims. It is audited as such.

New or changed destinations are merchant-authored settings, with authenticated actor and before/after receipt data. They are never taken from extraction automatically. The UI should present vendor changes as explicit trust decisions. Policy updates increment the policy version.

### POST /api/paypal/records

Sandbox-only trusted capture import:

```json
{"orderId":"ACTUAL-PAYPAL-SANDBOX-ORDER-ID"}
```

Fetches Orders v2 with the server's sandbox credentials, accepts exactly one capture, and imports its amount, currency, status, original capture ID and time. Refund requests refresh their actual order before deciding. Unsupported/ambiguous partial-refund history is held for reconciliation rather than guessed. Pending or uncertain local refunds reserve remaining captured funds atomically. Reconciliation is conservative and can over-reserve if an upstream result and refresh race; clear such cases manually only after checking PayPal.

Alternatively send `{"disputeId":"ACTUAL-DISPUTE-ID"}`. The service retrieves the current dispute, matches its seller transaction to an already imported order's capture, imports its actual deadline/status, and refuses unmatched records. The merchant can then record shipping evidence and process a dispute notice. Evidence execution checks PayPal's current `provide-evidence` link again before submitting the trusted order's tracking information.

### POST /api/paypal/orders

Create an actual sandbox checkout order:

```json
{"action":"create","amountCents":8900,"requestId":"checkout-unique-001"}
```

Returns `{operation, state}`. `operation.result` contains `orderId`, PayPal's status and an `approvalUrl` restricted to PayPal's sandbox checkout origin. Redirect the sandbox buyer to that URL. Return/cancel URLs are fixed to this application's origin. They do not automatically capture.

After buyer approval, capture explicitly:

```json
{"action":"capture","orderId":"ACTUAL-ORDER-ID","requestId":"capture-unique-001"}
```

Only an order created through this seller's checkout flow can be captured here. The response imports the original capture and returns its `captureStatus`, amount and currency. An operation marked `completed` means the HTTP operation completed; the capture's actual status must also be checked before treating money as settled. The JSON `requestId` must remain stable across retries. Create is deduplicated by seller/requestId; capture is deduplicated by actual order ID even when the browser changes requestId. Every operation is durably reserved before external I/O; uncertain failures require reconciliation, not automatic resubmission.

### POST /api/paypal/webhooks

This endpoint uses PayPal signature authentication instead of visitor identity or Origin. It rejects absent signature headers and calls PayPal's sandbox `verify-webhook-signature` for **every** delivery, including duplicate event IDs. A valid signature is required before any ledger mutation. It refetches the current resource using server credentials, reconciles payout item success/failure, refund completion, invoice status, known-order captures and dispute records, and appends an event receipt. Event IDs deduplicate updates atomically; event bodies do not create new payment authority. Early callbacks can match the stable reserved kernel key before the initial HTTP result has been saved.

Owner-private Sites may reject PayPal's anonymous HTTP request at the hosting gate before it reaches this route. Keep the Site private. Actual delivery requires a trusted external relay that preserves PayPal's signature headers/body and supplies Sites service access, or a platform-supported callback access exception. Neither is provisioned automatically. Do not claim successful delivery until an actual signed sandbox event reaches this endpoint. Webhook simulator events may not verify against a real configured webhook ID.

### GET /api/health

Authenticates, checks D1 connectivity and reports the current rail/extractor. In configured sandbox mode, it verifies OAuth. Demo mode makes no PayPal call. It does not claim that each enabled PayPal API permission has been tested.

## Extraction

Without extractor secrets, the service uses the clearly labeled deterministic rule demo in `lib/extract.ts`. Optional `EXTRACTOR_URL`, `EXTRACTOR_KEY` and `EXTRACTOR_MODEL` configure an HTTPS OpenAI-compatible chat-completions endpoint with strict JSON-schema output and no tools. Its output is revalidated locally and every claim is labeled `tainted:model`. A malformed or unavailable model falls back to the rule demo, with a visible fallback reason. The model cannot choose credentials, URLs, tool names or trusted provenance.

## Persistence, idempotency and receipts

Drizzle declares schema-only D1 migrations. Seed rows are inserted during first access, not in migration SQL. `npm run setup` always runs migration generation before building, then derives an ignored `.wrangler/custody-migrations.json` from the built DB binding with an absolute `drizzle` path. Wrangler applies only filenames not already recorded in that local database. Both migration application and the application use `.wrangler/state` with the same database identity. The seller snapshot is updated with optimistic compare-and-swap on a monotonically increasing version. Receipt appends and execution reservations happen in the same atomic update, so parallel requests cannot fork the chain or reserve the same invoice twice. Contention retries rerun only pure local calculations. PayPal calls happen after a winning reservation, outside retries. The full canonical kernel idempotency key is SHA-256 shortened for `PayPal-Request-Id` and Payouts' `sender_batch_id`.

The demo stores a bounded ledger snapshot; writes stop at 1.7 MB before D1's per-row limit. Export/archive outside the application before reaching this limit. It is suitable for a hackathon dataset, not indefinite high-volume accounting. There is no automatic destructive reset route.

Each event receipt hashes canonical JSON containing its index, timestamp, previous hash, event and data. GET state recomputes the chain. This detects accidental modification or broken linkage within stored events; without an external signed head or independent anchor it does not prove integrity against a database writer who can rewrite the entire chain. Historical receipts retain the original decision; approval/execution changes append new events.

## Sandbox adapter scope and remaining work

Implemented server-side HTTP methods: OAuth, Payouts v1 creation, Payments v2 capture refunds, Invoicing v2 draft+send, Orders v2 read/create/capture, Disputes v1 read+provide-evidence, and webhook-signature verification. The origin is permanently `https://api-m.sandbox.paypal.com`. Default demo addresses and `DEMO-*` references are rejected by actual rail execution.

The active seller API wires payouts, refunds, invoicing, order creation/capture/import, trusted dispute import, explicit shipping-evidence settings and signed-webhook reconciliation. A dedicated checkout buyer-approval screen, webhook relay provisioning, polling/reconciliation administration, passkeys, inbound email and a production rail are not implemented. The optional [PayPal Agent Toolkit refund bridge](TOOLKIT.md) is a separate server integration module, with required trusted host callbacks and no application route; its package is not installed by default. No credentials were supplied for an end-to-end sandbox run; the local benchmark measures policy behavior, not PayPal settlement or LLM attack rates. Hosted browser/API verification remains necessary after a successful build.

API shapes were checked against PayPal's official documentation: [OAuth](https://developer.paypal.com/api/rest/authentication/), [Payouts](https://developer.paypal.com/docs/api/payments.payouts-batch/v1/), [refunds](https://developer.paypal.com/api/payments/v2/captures-refund), [invoicing](https://developer.paypal.com/api/invoicing/v2/), [dispute evidence](https://developer.paypal.com/platforms/disputes/handle-disputes/use-disputes-api/).

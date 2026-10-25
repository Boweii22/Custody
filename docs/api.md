# Custody service

Real sandbox only. Unset or unsupported rail configuration cannot select a simulated adapter. There is no production PayPal origin. The real ledger is separate from legacy fictional state. All responses are uncached JSON.

## Identity and request boundary

Sites supplies dispatch-authenticated user ID and email. The Site remains owner-private. An owner binding protects setup; the configured `CUSTODY_SELLER_ID` must match the authenticated user before sandbox execution. Local inspection identity cannot authorize sandbox execution. Do not expose this Worker behind caller-controlled identity headers.

POST mutations require same-origin `Origin`, appropriate fetch metadata, JSON content type and a body within 18 KB. Text processing allows 3–6,000 characters. Limits and reservations are durable in D1. All external execution is fixed to PayPal sandbox with server-only credentials.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /api/state` | Initializes an empty real ledger with disabled policy templates. Returns identity, records, decisions, actual stored checkout operations, receipt-chain verification, capabilities and readiness checks. Configured values do not establish verified service access. |
| `GET /api/health` | Database and connection readiness. Setup-required or unverified services are explicit; this is not a payment-settlement test. |
| `POST /api/connections/verify` | Explicit provider connection check. Verifies configured PayPal OAuth and model extraction service, stores verification evidence without payment records or secrets. |
| `POST /api/process` | `{subject?,text,kind?,arena?:false}`. Requires real configured providers and seller identity. Calls actual constrained model extraction. Missing/invalid model output fails closed. `kind` can select a supported playbook but cannot supply authority. Simulated arena requests are rejected. |
| `POST /api/decisions/:id` | `{action:'approve'|'reject'}`. Rechecks trusted records and policy; owner approval can grant one-time amount-cap exceptions only. Missing destinations, duplicates, expired refunds and over-refunds cannot be approved. |
| `POST /api/settings` | Explicit owner policy, vendor, customer or order-evidence updates. Submitted messages never edit authority stores. |
| `POST /api/paypal/orders` | `{action:'create',amountCents,requestId}` or `{action:'capture',orderId,requestId}`. Creates actual PayPal sandbox checkout, returns approval URL; capture requires an order created by this seller flow. No automatic buyer approval. |
| `POST /api/paypal/records` | `{orderId}` or `{disputeId}`. Fetches actual upstream records. A dispute must match the capture of an imported order. |
| `POST /api/paypal/reconcile` | Refreshes recorded provider references without submitting payment operations. Reports unresolved or inconsistent results explicitly. |
| `POST /api/paypal/webhooks` | Requires verified PayPal signature and configured webhook ID. Owner-private dispatch also needs a supported provider callback access path; a route alone does not establish delivery. |

Responses that update workspace data include `state`. Decision operations include `decision`; checkout includes `operation`. Client-facing errors contain a safe `error` string. Provider payloads and secrets are not echoed in error responses. Confirm exact fields in route handlers before integrating an external client.

## State and decisions

`mode` is `unconfigured` or `sandbox`; `extractor` is `unconfigured` or `model`. `readiness.checks` records each dependency's status and explanation. Empty business arrays are real absence of data, not simulated balances. A zero activity counter does not establish money saved or a measured provider balance.

Decisions contain an ID, UTC timestamp, source text, kind, amount, kernel verdict, checks, provenance, resolved plan, minimal execution arguments when allowed, receipt and optional provider result. `allow` is authorization of the resolved plan, not settlement. `pending` is unconfirmed. `failed` may be ambiguous and remains reserved. `paid`, `refunded`, `invoiced` and `evidence` require relevant upstream outcomes; do not relabel them as production money.

The animation replays a stored decision. It never calls a payment route. Receipt hashes verify internal chain consistency, not independent external immutability.

## Authority updates

Policy updates use `{type:'policy',policy:{id,enabled,maxAmountCents,refundWindowDays?}}`. Initial templates are disabled until an owner authorizes them.

Vendor updates use `{type:'vendor',vendor:{id?,name,email,limitCents,verified:true,aliases?}}`. Customer updates use `{type:'customer',customer:{id?,name,email,verified:true}}`. The owner must verify an actual sandbox recipient. Reserved fixture domains cannot become real execution recipients.

Order evidence uses `{type:'order_evidence',orderId,trackingNumber,carrier,deliveredAt}` for an existing imported order. Evidence is a merchant assertion and must be true. Unsupported dispute reasons/evidence types must fail closed rather than being silently rewritten as fulfillment evidence.

## Operational limits

USD only, single seller, bounded 1.7 MB state snapshot. Duplicate keys are atomically reserved before external execution. Failed or uncertain actions are not automatically retried or released. Known references can be reconciled; an unknown provider outcome may need investigation in the PayPal dashboard. A new browser request ID must not be used to bypass an uncertain operation.

See [real sandbox setup and acceptance evidence](REAL-SANDBOX-SETUP.md). No provider-backed acceptance result exists until actual account tests have run.

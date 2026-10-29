# Custody service

Real sandbox only. Unset or unsupported rail configuration cannot select a simulated adapter. There is no production PayPal origin. The real ledger is separate from legacy fictional state. All responses are uncached JSON.

## Identity and request boundary

Sites supplies dispatch-authenticated user ID and email. The hosted Site remains owner-private. An owner binding protects setup; the configured `CUSTODY_SELLER_ID` must match the authenticated user before sandbox execution. Ordinary local inspection identity cannot authorize sandbox execution. The explicit [judge opt-in](JUDGES.md) permits a loopback-only workspace with a generated `CUSTODY_LOCAL_AUTH_TOKEN` supplied in `X-Custody-Local-Token`; remote requests cannot use this path. Do not expose this Worker behind caller-controlled identity headers.

POST mutations require same-origin `Origin`, appropriate fetch metadata, JSON content type and a body within 18 KB. Text processing allows 3–6,000 characters. Limits and reservations are durable in D1. All external execution is fixed to PayPal sandbox with server-only credentials.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /api/state` | Initializes an empty real ledger with disabled policy templates. Returns identity, records, decisions, actual stored checkout operations, receipt-chain verification, capabilities and readiness checks. Configured values do not establish verified service access. |
| `GET /api/health` | Database and connection readiness. Setup-required or unverified services are explicit; this is not a payment-settlement test. |
| `GET /api/receipts` | Authenticated, uncached export of the complete event receipt chain with its server verification summary. It does not execute or reconcile a payment. Individual decision exports contain only their embedded creation receipt plus current fields. |
| `POST /api/connections/verify` | `{scope:'paypal'|'all'}` (default `all`). Explicit provider connection check. PayPal-only checks actual OAuth without requiring a model; all checks also call constrained model extraction. Stores verification evidence without payment records or secrets. Authentication, origin checks and configuration restrictions apply to both scopes. |
| `POST /api/process` | `{subject?,text,authorization:{kind,targetId,maxAmountCents,confirmed:true},arena?:false}`. Requires configured providers, seller authentication, an existing trusted target and an explicit owner task outside message text. Calls actual constrained extraction; an extracted target/action/amount outside that task cannot execute. The old top-level `kind` override is rejected. Missing/invalid model output fails closed; simulated arena requests are rejected. |
| `POST /api/decisions/:id` | `{action:'approve'|'reject'}`. Rechecks trusted records, standing policy and the original owner task. Legacy decisions without a stored bound task cannot be approved. A one-time standing-policy/vendor cap exception cannot bypass the original task ceiling, task target, missing destinations, duplicates, expired refunds or over-refunds. |
| `POST /api/settings` | Explicit owner policy, vendor, customer or order-evidence updates. Submitted messages never edit authority stores. |
| `POST /api/paypal/orders` | `{action:'create',amountCents,requestId}` or `{action:'capture',orderId,requestId}`. Creates actual PayPal sandbox checkout, returns approval URL; capture requires an order created by this seller flow. No automatic buyer approval. |
| `POST /api/paypal/records` | `{orderId}` or `{disputeId}`. Fetches actual upstream records. A dispute must match the capture of an imported order. |
| `POST /api/paypal/reconcile` | Refreshes recorded provider references without submitting payment operations. Reports unresolved or inconsistent results explicitly. |
| `POST /api/paypal/webhooks` | Requires verified PayPal signature and configured webhook ID. Owner-private dispatch also needs a supported provider callback access path; a route alone does not establish delivery. |

Responses that update workspace data include `state`. Decision operations include `decision`; checkout includes `operation`. Client-facing errors contain a safe `error` string. Provider payloads and secrets are not echoed in error responses. Confirm exact fields in route handlers before integrating an external client.

## State and decisions

`mode` is `unconfigured` or `sandbox`; `extractor` is `unconfigured` or `model`. `readiness.checks` records each dependency's status and explanation. Empty business arrays are real absence of data, not simulated balances. A zero activity counter does not establish money saved or a measured provider balance.

Decisions contain an ID, UTC timestamp, source text, kind, amount, kernel verdict, checks, provenance, resolved plan, minimal execution arguments when allowed, receipt and optional provider result. New decisions also store the owner-selected task with a server-supplied actor/time; neither is taken from model output. `allow` is authorization of the resolved plan, not settlement. `pending` is unconfirmed. `failed` may be ambiguous and remains reserved. `paid`, `refunded`, `invoiced` and `evidence` require relevant upstream outcomes; do not relabel them as production money.

The animation replays a stored decision. It never calls a payment route. Receipt hashes verify internal chain consistency, not independent external immutability.

## Authority updates

Policy updates use `{type:'policy',policy:{id,enabled,maxAmountCents,refundWindowDays?}}`. Initial templates are disabled until an owner authorizes them.

Vendor updates use `{type:'vendor',vendor:{id?,name,email,limitCents,verified:true,aliases?}}`. Customer updates use `{type:'customer',customer:{id?,name,email,verified:true}}`. The owner must verify an actual sandbox recipient. Reserved fixture domains cannot become real execution recipients.

Order evidence uses `{type:'order_evidence',orderId,trackingNumber,carrier,deliveredAt}` for an existing imported order. Evidence is a merchant assertion and must be true. Unsupported dispute reasons/evidence types must fail closed rather than being silently rewritten as fulfillment evidence.

## Operational limits

USD only, single seller, bounded 1.7 MB state snapshot. Duplicate keys are atomically reserved before external execution. Failed or uncertain actions are not automatically retried or released. Known references can be reconciled; an unknown provider outcome may need investigation in the PayPal dashboard. A new browser request ID must not be used to bypass an uncertain operation.

See [real sandbox setup and acceptance evidence](REAL-SANDBOX-SETUP.md), [judge setup](JUDGES.md) and the actual recorded evidence in [`evidence/`](../evidence/). A recorded successful operation does not establish permission or correctness for every other adapter capability.

# Custody

Every dollar knows who asked for it.

[Source repository](https://github.com/Boweii22/Custody) · [Hosted workspace](https://custody-money-agent-bowei.no1tomcodes.chatgpt.site/) · [MIT license](LICENSE)

Custody is an owner-private money-agent application with a deterministic provenance gate before PayPal execution. Untrusted message/model claims can identify a request; canonical seller records supply protected destinations. The UI includes a ledger, owner review, verified counterparty books, playbooks and an animated replay of stored decision evidence.

**Status: real sandbox integration in progress; not fully verified or complete.** Owner-supplied PayPal sandbox credentials successfully authenticated against PayPal on October 26, 2026. No PayPal settlement or model call has yet been verified. OAuth, configuration, software tests and a successful deployment are distinct from completed payment operations.

The operating application starts with an empty ledger, no fictional counterparties or orders and disabled policy templates. Missing credentials block processing. Model failures do not fall back to a simulated extractor. Legacy fictional state stays in its old database namespace; the real operating ledger uses a separate namespace. Test fixtures remain only as explicit software-test inputs. The simulated arena is unavailable in the real workspace.

## Run locally

Requires Node 22.13+ and npm:

```sh
npm run setup
npm run dev -- --hostname 127.0.0.1 --port 4381
```

Open `http://127.0.0.1:4381`. `setup` installs missing dependencies, generates/builds the Worker and applies local D1 migrations. The local database persists under `.wrangler/state`. Local development identity is for inspecting setup and software verification; it is not a sandbox seller authorization. Use the deployed authenticated Site for seller operations.

## Connect your accounts

Follow [real sandbox setup](docs/REAL-SANDBOX-SETUP.md). Enter credentials in the ignored local `.dev.vars` file or the Site's server-secret configuration. Local environment files do not configure hosting. Keep keys out of chat, source, client code and exported receipts.

Required values are `CUSTODY_RAIL=sandbox`, `CUSTODY_SELLER_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `EXTRACTOR_URL`, `EXTRACTOR_KEY` and `EXTRACTOR_MODEL`. `PAYPAL_WEBHOOK_ID` alone does not establish reachable or verified callback delivery. The PayPal origin is fixed to `https://api-m.sandbox.paypal.com`; production money movement is not implemented or authorized.

Use the actual signed-in owner ID shown in Connections. Sites dispatch supplies the hosted identity. Keep the Site owner-private; a first-owner database binding protects setup until an explicit seller ID is configured. Do not expose the Worker behind caller-controlled identity headers.

## Execution and evidence

1. A real configured model extracts constrained JSON without tools. The server validates the response and assigns tainted provenance.
2. The resolver retrieves canonical vendor, customer, PayPal order/capture and dispute records.
3. The pure kernel checks value bindings, policy, caps, currency, original destinations, duplicates and refund bounds.
4. An atomic ledger reservation precedes external execution. An allowed plan is not a completed payment.
5. The sandbox adapter calls PayPal. Pending and uncertain responses remain explicitly unconfirmed. Reconciliation re-reads provider records and does not re-submit payments.
6. The receipt chain and animated pipeline show the stored decision and provider status. Playback never executes an action.

The SHA-256 receipt chain detects internal inconsistencies; it is not an independently anchored immutable accounting system. Seller verification of a counterparty is an explicit owner assertion, not automatic proof that an invoice is genuine.

## Verify software

```sh
npm test
npm run typecheck
node scripts/smoke-api.mjs http://127.0.0.1:4381
```

The local smoke test checks empty-state and fail-closed boundaries without inserting fictional business data. Kernel tests include generated cases and mocked adapter contract tests. These tests do not establish working provider credentials, PayPal permissions, settlement, model accuracy or resistance to all prompt injection.

The historical `benchmark/report.json` records the previous deterministic-extractor simulation only. It is not a real PayPal or model benchmark and is not accepted as current completion evidence. Its old runtime corpus is retained for historical analysis and is incompatible with the disabled simulated arena.

## Remaining acceptance work

Real provider verification is required for OAuth and model extraction, checkout creation/buyer approval/capture, refund, payout and item reconciliation, invoice send and eligible dispute evidence. Preserve actual provider IDs, timestamps, expected destinations/amounts and sanitized upstream evidence. An API route or a passing unit test does not complete this work.

The earlier product plan includes an independently isolated public sandbox arena, provider-state attack scoring and an ungated baseline comparison. These are additional product goals, not mandatory hackathon eligibility requirements. The optional Agent Toolkit bridge in `lib/toolkit.ts` is not wired into the running REST application. Document/page ingestion, plain-English playbook compilation and end-to-end callback infrastructure also remain unfinished. There is no production or multi-tenant deployment.

The owner-private hosting boundary prevents anonymous PayPal callback delivery without supported service access or a separate relay. Do not broaden the audience to work around it. Authenticated reconciliation handles recorded references; ambiguous operations without a reference need provider investigation.

## Limits and source map

The single-seller D1 snapshot is bounded to 1.7 MB and needs explicit archiving before reaching capacity. This is not an indefinite-volume accounting service. Processing and model calls have durable rate/budget limits. Request text is stored in D1 and sent to the configured model provider; use only data you are authorized to process.

- `lib/kernel.ts`: deterministic authorization gate.
- `lib/server/`: identity, persistence, real extraction, PayPal REST and reconciliation.
- `app/`: React UI, connection setup, ledger and provenance animation.
- `tests/`: explicit software tests, including fixture-based cases.
- [API contract](docs/api.md), [threat model](docs/THREAT-MODEL.md), [Toolkit status](docs/TOOLKIT.md).

MIT license. No claim of universal payment safety or completed end-to-end operation is made.

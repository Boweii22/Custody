# Custody

Every dollar knows who asked for it.

[Open judge portal](https://boweii22.github.io/Custody/) · [Watch the 1:37 demo](https://www.youtube.com/watch?v=fBgxPdKP-4o) · [Public source](https://github.com/Boweii22/Custody) · [Judge instructions](docs/JUDGES.md) · [MIT license](LICENSE)

The public judge portal requires no login or API key. It is an interactive viewer of actual recorded evidence and the real-model evaluation; replay and inspection perform no payment writes. The [private owner workspace](https://custody-money-agent-bowei.no1tomcodes.chatgpt.site/) retains separate seller authentication and controls.

Custody is an assisted refund desk for merchants who want AI to read payment requests while keeping payment authority explicit. The merchant selects a trusted target and a maximum amount outside the message. A real model extracts claims. A deterministic gate checks that those claims fit the authorized task, trusted PayPal records and standing policy before a sandbox adapter can execute them.

The inbox, ledger and animated pipeline explain the same stored decision: what the message claimed, which record supplied authority, which checks passed, and what PayPal actually returned. Animation is labelled replay and cannot execute a payment.

## What has actually run

The core uses real external APIs in PayPal's sandbox; it does not move production funds. These are recorded integration checks, not fictional operating data:

| Evidence | Observed result |
| --- | --- |
| PayPal OAuth and buyer-approved checkout capture | Authenticated provider responses and completed captures, October 26, 2026 |
| OpenAI constrained extraction | Successful direct and hosted model verification, October 26 |
| Owner-authored USD 1.00 refund request | 13 kernel checks passed; PayPal refund `0UJ640930F074291C` returned `COMPLETED`; independently read from PayPal |
| Owner-authored forged-authority reattempt | Held on October 29: 12 checks passed, `refund_remaining` failed, and no execution or rail reference was created |
| Provider read after that security test | The original capture was `REFUNDED`; the order contained only the original USD 1.00 completed refund |
| Current task-bound, read-only evaluation | October 29: 16/16 authored-case expectations met; 3 clean controls, 0 false holds, 0 model errors and 0 payment calls; observed capture/refund amounts and refund IDs unchanged |

See the actual records in [`evidence/`](evidence/), the [public judge portal](https://boweii22.github.io/Custody/) or the local viewer at `/judge`. Those two recorded hosted decisions predate explicit per-request task binding; they establish the capture/refund and remaining-balance path, not verification of every later change. The new task gate has separate software tests and a reproducible [real-model, read-only evaluation](evaluation/README.md), with the observed result saved in [`evidence/real-model-report.json`](evidence/real-model-report.json). This is one small authored run with the returned GPT-4.1 Mini snapshot, not a statistical security guarantee; do not substitute the historical simulated benchmark.

Missing credentials fail closed. Model errors never fall back to a rule parser. The operating ledger starts empty, with disabled policy templates and no fictional counterparties. Software fixtures are confined to tests and historical analysis.

On 29 October, the current hosted task-binding build completed a fresh owner-authorized USD 0.01 sandbox refund. All 17 checks passed. Separate PayPal refund and order GETs confirmed completion on the original capture; all 25 event hashes and previous-hash links in the new private export verified. The [sanitized acceptance report](evidence/task-bound-refund-verification.json) records the selected task, one-cent ceiling, provider status and internal chain checks. It keeps actor IDs and raw exports private.

## Run and judge

Start with the [published judge portal](https://boweii22.github.io/Custody/) and [public demonstration video](https://www.youtube.com/watch?v=fBgxPdKP-4o). To inspect or run the source locally, use Node 22.13+ and npm. From a fresh checkout:

```sh
npm run setup
npm run dev -- --hostname 127.0.0.1 --port 4381
```

Open `http://127.0.0.1:4381/judge` to inspect the actual recorded evidence and replay its decisions. This viewer contains no payment credentials and performs no payment writes. The private hosted owner workspace is not an anonymous judge login.

To test real integrations with your own accounts, follow [the complete judge setup](docs/JUDGES.md). An explicit loopback-only opt-in creates an ignored local authentication token; provider keys stay in the ignored server env file. Hosted seller controls still require the authenticated configured owner. Never share the author's keys or expose the local server to the network.

```sh
node scripts/setup-judge.mjs --enable-local-sandbox
# Fill the ignored .dev.vars locally with your own sandbox/model credentials.
# Restart the server and unlock the local sandbox using its local token.
```

The local database persists under `.wrangler/state`. The ordinary local workspace remains unable to execute sandbox actions until this opt-in is configured. See [real sandbox setup](docs/REAL-SANDBOX-SETUP.md) for the hosted owner path and each environment key.

## The authority boundary

1. **Authorize a task.** The authenticated merchant chooses an existing trusted target, action and maximum amount outside untrusted text, then confirms that authority. The server records the actor and time.
2. **Extract claims.** An actual configured model returns strict JSON without tools. Its fields receive `tainted:model` labels from the server.
3. **Resolve and decide.** The resolver supplies canonical destinations. The task gate rejects a substituted target, action or amount ceiling. The pure policy kernel checks currency, caps, original capture, remaining refundable balance, return window and duplicate execution keys.
4. **Reserve before executing.** The durable ledger reserves an allowed action before the PayPal call. An allowed plan is not a completed payment.
5. **Record and reconcile.** PayPal's response determines the recorded state. Pending or uncertain operations remain unconfirmed. Reconciliation reads a known provider reference and does not resubmit money operations.

This boundary does not authenticate a customer email or establish that a commercial refund is justified. The merchant must verify that right before authorizing the task. A compromised owner account or trusted store remains powerful. See the [threat model](docs/THREAT-MODEL.md).

## Reproduce the evidence

```sh
npm test
npm run typecheck
node scripts/smoke-api.mjs http://127.0.0.1:4381
```

The current software suite has 59 passing tests, including explicit fixtures, generated kernel cases, reconciliation contracts, task-binding cases and CSV export safety. These tests do not claim provider settlement or model accuracy.

The [new evaluation](evaluation/README.md) calls a real model, fetches your actual sandbox orders, and evaluates the production pure resolver/kernel/task gate. It contains no payment writer. It reports clean-control false holds, failed cases, model errors, planned arguments and provider snapshots before/after. It is deliberately distinct from a hosted end-to-end payment test.

Individual decision exports contain a creation receipt and current decision fields. A valid embedded hash does not independently authenticate every later execution field or export the complete ledger chain. An offline check of the private full-chain export verified all 22 event hashes and continuity links, including the two public receipts and the linked refund execution event; the [sanitized verification summary](evidence/full-chain-verification.json) retains those results and the source-file hash. The raw chain remains private because it contains internal actor IDs and old checkout approval URLs. SHA-256 detects inconsistencies; this check is not externally anchored immutable accounting or a new provider-status query.

The old [`benchmark/`](benchmark/) targets the former deterministic-extractor simulation. Its report is historical, incompatible with the disabled arena, and is not current real-model or PayPal evidence.

## Deliberate scope

The demonstrated hackathon story is owner-authorized refund processing and inspectable payment boundaries. PayPal sandbox plus meaningful AI satisfies the platform scope of the [hackathon rules](https://paypalaihackathon.devpost.com/rules); production money and every PayPal product are not required.

Payout, invoice and dispute adapter code exists but has not been verified end to end in the recorded acceptance run. The optional Agent Toolkit bridge is not the running REST integration. Public attack-money arenas, baseline comparisons, document ingestion and natural-language policy compilation are not presented as completed features. The workspace is single-seller, not multi-tenant.

Private hosting does not establish anonymous PayPal webhook delivery. Authenticated reconciliation is the supported recorded-reference recovery path; uncertain operations without a reference require provider investigation. The D1 snapshot is bounded to 1.7 MB, so sustained production-scale operation needs archival/storage work. Request text is stored and sent to the configured model; use only data you are authorized to process.

## Source map

- `lib/kernel.ts`, `lib/task-authority.ts`: pure deterministic gates.
- `lib/server/`: authentication, persistence, constrained extraction, PayPal and reconciliation.
- `app/`: operating workspace and actual-record judge viewer.
- `evaluation/`: real-model/read-only provider evaluation, with explicit scope labels.
- `evidence/`: sanitized recorded provider and decision evidence.
- [API contract](docs/api.md), [judge setup](docs/JUDGES.md), [threat model](docs/THREAT-MODEL.md), [submission text](docs/SUBMISSION.md), [video script](docs/DEMO-SCRIPT.md).

## Submission status

The MIT repository, public judge portal and public 1:37 YouTube demonstration are published and verified. The hardened seller workspace remains owner-private. The entrant is preparing the Devpost draft; final submission has not yet been verified. Entrant/team fields, eligibility and rights, required terms and final submission remain the entrant's responsibility. Use the [ready submission text](docs/SUBMISSION.md) and verify Devpost's confirmation afterward.

MIT license. No universal prompt-injection, fraud-prevention or winning claim is made.

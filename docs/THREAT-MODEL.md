# Custody threat model

Custody separates proposed payment claims from payment authority. A real extractor parses untrusted text. The merchant selects a specific trusted target, action and maximum outside that text. The resolver and deterministic gates constrain the executable call to that task and canonical records.

This is an implemented boundary with scoped evidence, not a certification that all prompt injection, fraud or payment loss has been prevented.

## Trust boundaries

| Surface | Trust and permitted role |
| --- | --- |
| Pasted message, subject, claimed sender and embedded markup | Untrusted; may state payment claims, never grant authority |
| Model output, including apparent labels or tool instructions | Untrusted; server-generated labels mark its fields `tainted:model` |
| Authenticated owner's task form | Authority for one selected playbook, existing target and maximum; actor/time come from the server |
| Vendor/customer book | Owner-controlled canonical destinations after explicit independent verification |
| Server-fetched PayPal record | Capture identity, currency, amount and observed refund history |
| Enabled versioned policy | Standing tool/currency/cap/window authority |
| Stored owner review | Bounded review of an existing task; cannot replace that task or financial invariants |
| Browser display and animation | Presentation/replay, without authority to change stored payment arguments |

Hosted execution requires the configured owner authenticated by Sites. Ordinary local development is inspection-only. The explicit own-account judge opt-in additionally supports loopback requests authenticated by a generated local token; the hosted path ignores that token. Neither a caller-provided identity header nor the word `trusted` in a message authenticates a user.

## Attacker capability

The attacker may control the entire pasted message and subject, impersonate system prompts, forge JSON/approval/provenance labels, name a different real order, suggest an alternate receiver, repeat claims or alter amount/currency. Assume a fully compromised extraction can propose arbitrary schema-valid claims.

The attacker is not assumed to possess an authenticated merchant session, alter the merchant-selected task outside the message, change trusted records or code, steal server credentials, or control PayPal. A compromised owner account is outside that boundary and remains powerful.

## Enforced controls

An operational request needs an explicit owner task with a supported playbook, an existing canonical target, a positive integer USD ceiling and confirmed merchant authorization. The server records who supplied it and when. Model output cannot overwrite that playbook selection. The task gate blocks a different action, different resolved target, missing task or excess amount and removes execution arguments on failure.

A protected destination must have the required trusted label **and** equal the value resolved from its canonical record. A forged label alone cannot authorize an unrelated receiver. Refunds resolve the original capture and cannot add an alternate recipient to the refund rail. Amounts must fit both standing and task limits, be exact positive USD cents, remain within the actual refundable balance and meet the return window. Duplicate source/invoice keys are reserved before network execution.

Owner review re-resolves current trusted records and retains the original task. It cannot approve a different target, an amount above the task ceiling, an over-refund, an expired refund or a duplicate. Historical pre-task-binding decisions remain inspectable but cannot gain execution through legacy approval.

An attacker-supplied receiver can be discarded while a canonical original capture is allowed. An `allow` verdict alone is not an attack success; inspect the minimal execution arguments. A `hold` is a failed invariant requiring attention, not a classifier proving the text malicious.

## Limits that matter

**Commercial entitlement remains a merchant decision.** The application does not authenticate the person who authored pasted text or prove that goods, invoices or refunds are justified. The owner must independently verify the underlying request before authorizing a target/task. Future integration with signed tickets, authenticated customer sessions or trusted order-management tasks would require its own verification.

**A valid extraction is not necessarily a correct extraction.** Schema validation establishes shape. The model may misread an amount or request. The task maximum bounds the authorized amount rather than proving the exact semantic amount owed. Inspect the real-model evaluation's legitimate-control errors and failed cases, not only its denied attacks.

**Trusted stores and owner sessions remain powerful.** A compromised vendor book can change destination authority; a compromised or malicious owner can deliberately authorize harmful work. Provenance cannot determine whether an independently verified owner action was wise or coerced. Protect accounts, server configuration and store mutation.

**Provider and concurrency assumptions require evidence.** The ledger reserves before execution, retains uncertain outcomes and reconciles known provider references without resubmitting. A network error with no reference may require investigation. Incorrect provider history, stale records, account permissions and concurrent external merchant actions still matter. Provider status must establish completion; an allowed plan or replay cannot do so.

**Receipts have a defined integrity scope.** SHA-256 chain checks detect internal inconsistencies but are not externally anchored immutable accounting. Individual decision exports contain a creation receipt and current fields; their embedded hash does not bind every later execution field. The full authenticated chain export includes separate execution events for continuity verification. Compare recorded provider references with PayPal for actual status.

**Availability and data disclosure are separate surfaces.** Limits and budget breakers reduce abuse but do not prove resistance to outages, distributed denial of service, dependency compromise or owner-account takeover. Pasted text is stored and sent to the model endpoint. Text must render plainly; no generated payment prose should be treated as commercial truth or authorization.

**Scope is single-seller sandbox.** There is no production payment path, multi-tenant isolation claim, anonymous webhook-delivery claim, live attack-money arena or implemented vulnerable-agent baseline. Keep the merchant workspace protected. Never expose local authentication or server secrets in a recording or public source.

## Evidence and falsification

The actual recorded hosted core includes a completed USD 1.00 refund and a forged-authority reattempt held against its exhausted balance. Those decisions predate the later explicit task gate. The current gate has separate software tests and a reproducible real-model/read-only evaluation using fresh PayPal snapshots and the production pure resolver/kernel/task gate. It does not execute payment plans or test the complete hosted handler.

The older `benchmark/` is historical simulated/deterministic-extractor evidence. Its counts are not real-model robustness, provider-state theft measurement or a baseline comparison.

A failed authority boundary includes any executable plan whose action, target or amount exceeds the merchant-selected task, or whose protected destination does not equal the required canonical record. Retain the full actual input, task, model claims, observed checks, planned arguments and provider record when reporting a failure. Publish failures and false holds as well as successes.

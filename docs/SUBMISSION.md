# Custody â€” submission copy

[Public judge portal](https://boweii22.github.io/Custody/) Â· [Public 1:37 video](https://www.youtube.com/watch?v=fBgxPdKP-4o) Â· [Public MIT repository](https://github.com/Boweii22/Custody)

These three publication paths are live and verified. This file is ready-to-paste submission content; it does not establish that a Devpost draft has been saved or an entry submitted. The entrant's sign-in, team fields, eligibility/rights review, required terms and final Devpost submission remain human steps.

## Project name

Custody â€” Every dollar knows who asked for it

## Tagline

A message can request a refund but never authorize one. Custody lets AI read refund requests while merchant-approved tasks and trusted PayPal records decide where every dollar goes.

## Inspiration

Payment agents read text that may contain both a legitimate request and instructions planted by someone else. A model can extract a convincing amount, order or recipient without having authority to act on it. We wanted the payment boundary to remain inspectable when the model makes a mistake.

The first audience is independent online merchants who review refund requests. They need a clear way to approve the intended task, apply consistent payment limits and understand why an action ran or stopped.

The [one-page impact case](https://github.com/Boweii22/Custody/blob/main/docs/IMPACT.md) separates this target-user hypothesis from measured evidence. We claim no merchant adoption, interviews, time savings or loss-prevention statistic. The demonstrated value is the working path from a specific merchant-approved task to bounded payment arguments and an inspectable outcome.

## What it does

The merchant independently verifies a request and selects its playbook, trusted target and maximum amount outside the pasted message. Custody sends the text to a real model for constrained extraction. Every model field stays labelled as an untrusted claim.

A deterministic task gate rejects a different action, different target or excess task amount. The payment kernel resolves the original PayPal capture and checks policy, exact USD cents, remaining refund balance, timing and duplicate execution. An allowed action is reserved before the sandbox adapter runs. PayPal's actual response determines the recorded status.

The inbox, ledger and animated provenance pipeline expose the same record. Violet fields show message claims; trusted records supply protected values. Each decision can be inspected and exported. Replay never submits another payment.

The recorded core includes a completed USD 1.00 PayPal sandbox refund and an owner-authored forged-authority reattempt that was held against the exhausted balance. An independent provider read confirmed that only the original completed refund existed. These are actual sandbox records, not simulated transactions.

On 29 October, the current hosted task-binding version also completed a fresh owner-submitted USD 0.01 refund. The owner selected the original order and a one-cent ceiling before extraction; all 17 checks passed. Independent PayPal refund and order reads confirmed the completed refund on the original capture. This validates that specific bounded sandbox flow, not every supported adapter or production use.

## How we built it

- TypeScript and React with Vinext for the operating interface and API.
- PayPal Orders and Payments APIs for sandbox checkout, approved capture, refund and status reads.
- OpenAI-compatible strict JSON extraction; the recorded integration used the GPT-4.1 Mini snapshot returned by OpenAI. The model has no payment tools.
- A pure deterministic resolver, payment kernel and explicit task-authority gate.
- Cloudflare Worker/D1 persistence with compare-and-swap reservations, rate limits, idempotency and receipt events.
- AG Grid Community for inspecting and exporting ledger rows.

The submission video uses generated HeyGen narration over actual interface/evidence footage. That narration is presentation material, not evidence that a payment or security check ran.

The protected hosted workspace uses Sites identity. A loopback-only, token-authenticated opt-in lets judges reproduce real integrations with their own accounts. The public GitHub Pages portal and local viewer expose sanitized actual records, labelled replay and the real-model evaluation without credentials or payment writes.

## Challenges

A provenance label alone is not proof: the value also has to match a canonical record. A valid record is not permission to choose any record, so we added explicit task binding outside the model's input. The network can also fail after a provider action has started; uncertain outcomes must stay reserved and be reconciled instead of being retried as new payments.

We separated configuration, model verification, allowed plans, provider completion and historical replay so the interface does not confuse them. We also keep individual receipt-hash checks distinct from complete chain continuity and independent provider status.

## What we are proud of

The actual model-to-kernel-to-PayPal refund flow has run. The held reattempt has an exported receipt and a provider history check showing no second refund. These two historical hosted records predate the later task-binding change. The current software suite has 59 passing tests; in one reproducible real-model/read-only run, all 16 authored-case expectations were met, including 3 clean controls with no false holds. It made no payment calls, and the before/after PayPal capture/refund amounts and refund IDs were unchanged. The complete report preserves actual claims, checks, request IDs and scope; this small corpus is not a universal security success rate.

The visual pipeline makes a security decision understandable without relying on a model-written explanation. An offline verification also checked all 22 event hashes and continuity links in the private exported receipt chain and matched both public receipts to it. A sanitized summary is public; the raw chain remains private. This is internal continuity evidence, not externally anchored proof or a new provider-status query.

After the fresh task-bound refund, the new private export contained 25 events. All 25 hashes and previous-hash links verified, including the owner-bound creation at index 24 and its completed execution at index 25. The [newer acceptance report](../evidence/task-bound-refund-verification.json) is published separately from the labelled historical records.

## What we learned

Structured JSON is a useful parser boundary, but it does not make the fields true or authorize a payment. Explicit merchant authority, canonical values and independently verified provider outcomes answer different questions. Making those distinctions visible helps a reviewer understand both successful and withheld actions.

## What is next

The commercial request still needs merchant verification. Future work includes authenticated customer/order-management tasks, merchant usability studies, broader independent red-team evaluation and separate acceptance tests for other PayPal products. Production operation, multi-tenant isolation and automatic webhook delivery are not claimed by this sandbox submission.

## How to test

1. Open the [public judge portal](https://boweii22.github.io/Custody/) with no login or API key. Inspect the actual recorded refund, held attack, pipeline replay and 16-case evaluation.
2. Watch the [1:37 public demonstration](https://www.youtube.com/watch?v=fBgxPdKP-4o). To reproduce locally, clone the public source and follow [JUDGES.md](https://github.com/Boweii22/Custody/blob/main/docs/JUDGES.md).
3. For a fresh integration run, explicitly enable the loopback sandbox, provide your own sandbox/model credentials, approve a checkout using a separate sandbox buyer, and authorize a bounded refund task.
4. Run the documented real-model/read-only evaluation against your own actual captures. Its scope is distinct from the recorded hosted money operation.

Judge portal: https://boweii22.github.io/Custody/

Video: https://www.youtube.com/watch?v=fBgxPdKP-4o

Public MIT source: https://github.com/Boweii22/Custody

Historical full-chain verification summary: [evidence/full-chain-verification.json](https://github.com/Boweii22/Custody/blob/main/evidence/full-chain-verification.json)

The owner merchant workspace remains private. Judges do not need that account or its keys; the public portal and complete own-account local path are separate.

## Remaining Devpost handoff

- Sign in to Devpost and confirm hackathon registration and the correct entrant/team details.
- Paste the final links and description, review the [official eligibility, rights and submission rules](https://paypalaihackathon.devpost.com/rules), and accept required terms through the human submitter.
- Submit the entry, then check Devpost's actual confirmation. Published code, Pages and YouTube do not themselves submit a Devpost entry.
- Preserve the scope of the observed results. No merchant savings, customer adoption, universal injection resistance or winning odds have been measured or claimed.

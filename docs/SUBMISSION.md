# Custody — submission copy

This is the evidence-led submission text. Review the final video URL, source visibility and access path before submitting Devpost. Do not claim that a publication approval or a saved draft is a completed submission.

## Project name

Custody

## Tagline

An AI refund desk where merchant tasks and PayPal records bound every executable action.

## Inspiration

Payment agents read text that may contain both a legitimate request and instructions planted by someone else. A model can extract a convincing amount, order or recipient without having authority to act on it. We wanted the payment boundary to remain inspectable when the model makes a mistake.

The first audience is independent online merchants who review refund requests. They need a clear way to approve the intended task, apply consistent payment limits and understand why an action ran or stopped.

The [one-page impact case](IMPACT.md) separates this target-user hypothesis from measured evidence. We claim no merchant adoption, interviews, time savings or loss-prevention statistic. The demonstrated value is the working path from a specific merchant-approved task to bounded payment arguments and an inspectable outcome.

## What it does

The merchant independently verifies a request and selects its playbook, trusted target and maximum amount outside the pasted message. Custody sends the text to a real model for constrained extraction. Every model field stays labelled as an untrusted claim.

A deterministic task gate rejects a different action, different target or excess task amount. The payment kernel resolves the original PayPal capture and checks policy, exact USD cents, remaining refund balance, timing and duplicate execution. An allowed action is reserved before the sandbox adapter runs. PayPal's actual response determines the recorded status.

The inbox, ledger and animated provenance pipeline expose the same record. Violet fields show message claims; trusted records supply protected values. Each decision can be inspected and exported. Replay never submits another payment.

The recorded core includes a completed USD 1.00 PayPal sandbox refund and an owner-authored forged-authority reattempt that was held against the exhausted balance. An independent provider read confirmed that only the original completed refund existed. These are actual sandbox records, not simulated transactions.

## How we built it

- TypeScript and React with Vinext for the operating interface and API.
- PayPal Orders and Payments APIs for sandbox checkout, approved capture, refund and status reads.
- OpenAI-compatible strict JSON extraction; the recorded integration used the GPT-4.1 Mini snapshot returned by OpenAI. The model has no payment tools.
- A pure deterministic resolver, payment kernel and explicit task-authority gate.
- Cloudflare Worker/D1 persistence with compare-and-swap reservations, rate limits, idempotency and receipt events.
- AG Grid Community for inspecting and exporting ledger rows.

The submission video uses generated HeyGen narration over actual interface/evidence footage. That narration is presentation material, not evidence that a payment or security check ran.

The protected hosted workspace uses Sites identity. A loopback-only, token-authenticated opt-in lets judges reproduce real integrations with their own accounts. A credential-free local viewer exposes sanitized actual records and labelled replay.

## Challenges

A provenance label alone is not proof: the value also has to match a canonical record. A valid record is not permission to choose any record, so we added explicit task binding outside the model's input. The network can also fail after a provider action has started; uncertain outcomes must stay reserved and be reconciled instead of being retried as new payments.

We separated configuration, model verification, allowed plans, provider completion and historical replay so the interface does not confuse them. We also keep individual receipt-hash checks distinct from complete chain continuity and independent provider status.

## What we are proud of

The actual model-to-kernel-to-PayPal refund flow has run. The held reattempt has an exported receipt and a provider history check showing no second refund. The visual pipeline makes a security decision understandable without relying on a model-written explanation. In one reproducible real-model/read-only run, all 16 authored-case expectations were met, including 3 clean controls with no false holds. It made no payment calls, and the before/after PayPal capture/refund amounts and refund IDs were unchanged. The complete report preserves actual claims, checks, request IDs and scope; this small corpus is not a universal security success rate.

## What we learned

Structured JSON is a useful parser boundary, but it does not make the fields true or authorize a payment. Explicit merchant authority, canonical values and independently verified provider outcomes answer different questions. Making those distinctions visible helps a reviewer understand both successful and withheld actions.

## What is next

The commercial request still needs merchant verification. Future work includes authenticated customer/order-management tasks, merchant usability studies, broader independent red-team evaluation and separate acceptance tests for other PayPal products. Production operation, multi-tenant isolation and automatic webhook delivery are not claimed by this sandbox submission.

## How to test

1. Clone the public source repository and follow [JUDGES.md](JUDGES.md).
2. Run the credential-free `/judge` viewer to inspect the actual recorded refund and held attack.
3. For a fresh integration run, explicitly enable the loopback sandbox, provide your own sandbox/model credentials, approve a checkout using a separate sandbox buyer, and authorize a bounded refund task.
4. Run the documented real-model/read-only evaluation against your own actual captures. Its scope is distinct from the recorded hosted money operation.

Source: https://github.com/Boweii22/Custody

Private owner workspace: https://custody-money-agent-bowei.no1tomcodes.chatgpt.site/

The private owner URL is not an anonymous judge login. Use the final approved judge portal if one is published; the repository includes the complete independent local path.

## Final submission fields to resolve

- Confirm public repository visibility and MIT license detection.
- Link the completed public YouTube upload, under three minutes. The local video/storyboard alone is not a public video link.
- Include the tested judge instructions and actual accessible build path.
- Confirm all team/entrant fields and any required terms through the human submitter.
- Use only the observed evaluation totals from the reviewed report. Do not claim measured merchant savings, customer adoption, universal injection resistance or winning odds.

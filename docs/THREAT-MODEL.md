# Custody threat model

The claim is deliberately narrow: inbox text must not supply authority for a money destination. Custody resolves a claimed vendor, order or customer against an owner-controlled store, then a deterministic policy kernel checks the proposed call before execution. An extraction model is a parser, never an authority.

This document describes the implemented boundary, not a certification that all prompt injection, fraud or payment loss has been prevented.

## Trust boundaries

| Surface | Trust | Permitted role |
| --- | --- | --- |
| Email, pasted document text, product-page text, arena submissions | Untrusted | Suggest a task, claimed identity, invoice number and amount |
| Extractor output, including any apparent tool instructions or provenance labels | Untrusted | Structured claims only; the server creates labels |
| Owner-maintained vendor book | Trusted for vendor identity and destination | Resolve a selected vendor into the allowed payout receiver |
| Owner-maintained customer records | Trusted for client identity and destination | Resolve a selected customer into an invoice recipient |
| Capture/order records resolved by the server | Trusted within the active adapter | Supply capture identity, payment amount and refund history |
| Compiled playbooks | Owner authority | Set permitted tools, provenance requirements, caps and refund windows |
| Explicit owner approval | Owner authority | Grant a one-time amount-cap exception for an existing trusted destination |
| Browser and model-generated text | Untrusted | Present requests and explanations; they cannot grant themselves authority |

The arena is a simulated exercise: `arena: true` always uses the demo adapter. `DEMO-*` references are simulated. Demo records establish behavior of the local pipeline; they do not establish PayPal balances or settlement. Sandbox mode is a separate server configuration and its evidence must be identified separately. The current owner-authenticated arena is not an open inbound-email service; authored benchmark cases are not public submissions. Keep the hosted Site owner-private: the demo may bind its first authenticated visitor as owner. Configure the intended `CUSTODY_SELLER_ID` before any broader access; sandbox mode requires it explicitly. A shared seller snapshot is not tenant isolation.

## Attacker capability

The attacker may control the entire submitted message, subject, claimed sender and any text copied from an HTML email, PDF or product page. They may impersonate a system prompt, forge JSON, claim prior owner approval, encode instructions, insert hidden-looking markup and name a real vendor or order. They may repeat requests, alter invoice numbers and try destinations that fit the spending cap. The model may follow the malicious instructions and return a fully attacker-controlled extraction.

The attacker is not assumed to possess an authenticated owner session, the server's credentials, the ability to modify code or the trusted stores, or control over PayPal. A provenance label written inside an email is just email content.

## Enforced policy

For protected destination arguments, a trusted label is necessary but insufficient: the value must also equal the destination resolved from the selected trusted record. A forged `trusted:vendor_book` label cannot authorize an unrelated receiver. Derived values retain their input provenance unless a deterministic resolver supplies a new authoritative value.

The payout receiver must match the selected vendor-book record. A refund capture must match the resolved order/capture record; the payment rail returns a refund to the original payer. An invoice recipient must match the selected customer record. Unsupported actions, unresolved identities, invalid values and policy violations are rejected, held or blocked. A successful kernel decision authorizes only its resolved execution arguments. The shipped review flow can grant a one-time policy/vendor amount-cap exception; it cannot bless an inbox destination, an expired return, an over-refund or a duplicate payment. Arena decisions cannot receive seller approval.

The shipped default policy caps supplier payouts at $500, refunds at $250 and client invoices at $2,500 in USD. Amounts must be positive safe integer cents. Refunds also require the remaining refundable balance and a capture within the 30-day policy window. Duplicate invoice keys are checked using the task kind, selected target and normalized invoice number. Consult the code and active policy for the authoritative configuration.

An attacker-supplied receiver can be discarded and a trusted receiver used instead. Therefore an `allow` verdict is not itself an attack success. The executed arguments and the adapter's resulting state determine the outcome. Conversely, a `hold` is a request for owner attention, not proof that the input was malicious.

## Limits that matter

**A compromised vendor book compromises destination authority.** If an attacker changes an owner's vendor address or an owner approves the attacker's payee as a trusted record, that new value is trusted by design. Provenance checks cannot determine whether the owner intended that change. Protect store mutation and approval with authentication, authorization, session security and auditability before exposing owner controls.

**Caps do not authenticate invoices.** An attacker who can name a known vendor may induce a payment to that legitimate vendor, at an allowed amount, for a fabricated or repeated commercial obligation with a new invoice identifier. The kernel constrains the call; it does not establish that goods were delivered, that an invoice is genuine, or that a requested payment is economically justified. Purchase-order matching, signed invoices, supplier confirmation and stronger deduplication are additional controls.

**A valid extraction is not a true extraction.** Schema validity only establishes shape. The rule-based demo extractor and an optional model can misidentify vendors, amounts, dates and request types. The kernel still checks provenance, record equality and invariants, but semantic task correctness and extraction accuracy require separate evaluation. A model that emits arbitrary text has not been shown robust by a local deterministic corpus run.

**Owner authority remains powerful.** A compromised owner account, malicious owner or coerced approval can authorize harmful actions. Held actions must be reviewed against the underlying record, not approved solely because an AI explanation sounds confident. A local development identity is suitable for loopback demonstration only.

**Trusted inputs may still be stale or wrong.** Incorrect vendor/customer records, incomplete refund history, stale state, payment-provider responses and concurrency failures can invalidate assumptions. Adapter responses, idempotency, reconciliation, persistence and multi-instance consistency need independent verification for a deployment.

**Text output is a separate surface.** The guarantee does not cover abusive drafts, misleading summaries, data disclosure in generated prose, reputational harm, malicious links or the safety of a reply sent outside the payment tools. Do not render submitted HTML as executable markup. The arena's copied PDF/HTML/page placements exercise text handling, not a browser, a PDF renderer or OCR.

**Availability and operational abuse remain possible.** Rate limits, size limits and budget breakers reduce abuse but do not prove resistance to distributed denial of service, account takeover, dependency compromise or payment-provider outages. Arena runs are isolated demonstrations and must not share production payment authority.

## Evidence and falsification

Kernel tests can establish the tested invariants without a model or network. The HTTP corpus in `benchmark/` records actual server verdicts, execution arguments when present, the extraction method and adapter mode. It refuses to count absent execution data as a verified safe allowed call. Its local report is not a baseline comparison, a public red-team result or a PayPal-state benchmark.

A sandbox theft claim needs provider-side evidence: independently query the attacker's sandbox account or the payout/refund records before and after each isolated episode, retain transaction IDs, account roles and timestamps, and attribute movement to the tested episode. Use the same model, tools, tasks, seeds and budget for an ungated baseline, publish its exact prompt and reset state between trials. A screen animation, an `allow` status or a `DEMO-*` identifier is insufficient evidence.

The invariant is falsified by an unapproved execution whose protected destination is attacker-controlled and lacks the required trusted resolution, even if the amount is below every cap. Report such cases with the full request, decision receipt and adapter record.

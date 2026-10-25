# Custody — 2 minutes 40 seconds

> Historical presentation draft for the former fictional prototype. The current operating app has no demo rail, seeded messages or simulated arena. Do not use this script as evidence that current real-provider flows have run. Follow `REAL-SANDBOX-SETUP.md` and capture actual verified provider results before preparing a new recording.

Target runtime: **2:40**, including the closing card. Capture at 1920 × 1080. Use captions and leave enough time for the viewer to read each verdict. Record against the actual shipped interface; move a shot rather than implying a control exists. The evidence labels remain visible throughout.

Before recording, choose **one** mode: local demo or independently verified PayPal sandbox. Local mode uses the wording below. Replace the marked lines with sandbox wording only after collecting real provider-side receipts and confirming account state. Do not relabel demo references as PayPal transactions. Use stored receipt replay only with a persistent **REPLAY** label.

| Time | Picture and action | Voiceover / caption |
| --- | --- | --- |
| 0:00–0:12 | Black to paper ledger. A $480 supplier invoice opens. Highlight the appended “new payment address” instruction. Keep `LOCAL DEMO` visible. | “Your money agent reads this invoice. So does an attacker. One sentence asks it to send $480 somewhere else.” |
| 0:12–0:25 | Open the same payload in Rob Custody. The attacker address is legible. Send the attack once. | “The amount is ordinary. The vendor is real. The destination is the trap.” |
| 0:25–0:42 | Pipeline Lens: violet claims leave the inbox; the trusted vendor record enters; the kernel verdict lands. Show the actual held/blocked result or the safely resolved trusted destination. | “Custody lets the inbox ask for work. It never lets the inbox become the address book. A small deterministic kernel checks the destination before the payment adapter runs.” |
| 0:42–0:55 | Inspect the decision details. Compare claimed and resolved payee. Display the real decision reference and mode. | “This address came from the message. This one came from the owner's vendor book. That distinction is the authority boundary.” |
| 0:55–1:12 | Process a clean supplier invoice. Animate only the actual receipt stages. Open the resulting ledger entry and adapter reference. | “For a normal invoice, Custody resolves the supplier, checks the spending policy and records the result. In this local demo, payment references are simulated.” |
| 1:12–1:28 | Run a refund on a seeded order. Open the capture provenance and remaining refund amount. | “Refunds resolve the original capture. An email can't replace the payer with a new account. The policy also checks the refund amount and time window.” |
| 1:28–1:43 | Show a client invoice request. Inspect resolved customer recipient. Then show the responsive owner review screen for a held action. | “The same rule covers client invoices. When authority is missing, the owner gets a specific question to review, with the source of each field visible.” |
| 1:43–1:58 | Ledger: filter decisions, expand a provenance trail, export the actual rows. Keep amounts, statuses and mode readable. | “Every decision leaves a receipt: what was requested, what was resolved, which policy ran and what the adapter returned. The ledger is also the evidence behind the animation.” |
| 1:58–2:14 | Terminal alongside arena: run the kernel tests, then the HTTP benchmark. Show the report’s actual counts and `local_policy_verdicts` evidence label. | “The core policy is tested without an LLM. This published corpus sends ten attack patterns in four text placements through the real HTTP endpoint. It reports observed verdicts and destination checks.” |
| 2:14–2:28 | Rob Custody form and live local attempt history. No fabricated public count or invented leaderboard. | “Try your own payload. The arena uses isolated simulated money. A local pass is evidence about this policy path, not a claim that prompt injection is solved.” |
| 2:28–2:40 | Return to nested vault mark. Show hosted URL, repository URL and one sentence in large type. Hold final card for 4 seconds. | “Agents need payment power. They also need a boundary text can't cross. Custody. Every dollar knows who asked for it.” |

## Optional sandbox inserts

At 0:55, show a real sandbox payout or refund reference and a provider-side record with matching amount and destination. Say: “This run used PayPal's sandbox. Here is the matching provider record.” At 1:58, show sandbox-state results only if they were actually produced with the documented evaluation protocol. Keep local and sandbox result tables separate.

A vulnerable-agent split screen is optional and requires an implemented baseline run. Use the same model, tools and task, show its published prompt, and verify movement through sandbox state. Until that exists, demonstrate the attempted redirection and Custody's measured response without a staged “stolen” counter.

## Capture checklist

- Clear test data and select a known scenario before the take; use fresh invoice IDs to avoid accidental deduplication.
- Keep sandbox secrets, access tokens, owner credentials and personal customer data out of the recording.
- Use actual UI results and actual test output. If a flow holds or fails, explain it or reshoot after fixing the cause.
- Label demo, sandbox and replay at the point of use, not just in the description.
- Read the captions with sound off. The attempted destination change and the trusted destination should be clear by 0:55.
- Export at 2:40; allow no more than 2:50 including credits. Use original or appropriately licensed audio.

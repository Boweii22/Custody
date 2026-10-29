# Connect real sandbox services

The recorded core has called PayPal sandbox and OpenAI successfully; see [`evidence/`](../evidence/). Your own credentials are not verified by copying this repository. Sandbox transactions are actual records in PayPal's test environment, with no production funds.

For a complete fresh local installation, use [judge setup](JUDGES.md). The instructions below describe the hosted owner workspace.

## Hosted account setup

1. Open [PayPal Apps & Credentials](https://developer.paypal.com/dashboard/applications/sandbox), sign in and choose **Sandbox**. Create or use a REST app linked to a sandbox Business merchant account. A separate sandbox Personal buyer approves checkouts.
2. Configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `CUSTODY_RAIL=sandbox` as server secrets. Local `.dev.vars` does not configure hosting.
3. In deployed Custody, open **Connections** and copy the actual authenticated owner ID. Set `CUSTODY_SELLER_ID` to it. Sites supplies the hosted identity; caller-provided identity headers must never be used as authentication on a public Worker.
4. Configure `EXTRACTOR_URL`, `EXTRACTOR_KEY` and `EXTRACTOR_MODEL` as server secrets. The endpoint is an HTTPS OpenAI-compatible Chat Completions service supporting strict JSON schema, `temperature: 0` and `max_tokens`. The operating app reads `EXTRACTOR_KEY`; `OPENAI_API_KEY` alone is insufficient. There is no parser fallback. If using Codex key provisioning, complete the OpenAI Developers plugin's secure credential flow.
5. Redeploy the saved source version after changing hosted environment values. Preserve owner-private access. Never include keys in source, browser bundles, chat, URLs, recordings or receipts.

Official provider setup: [PayPal REST onboarding](https://developer.paypal.com/api/get-started/) and [checkout approval/capture](https://developer.paypal.com/api/rest/integration/orders-api).

## Verify the demonstrated refund flow

1. Select **Verify PayPal** for actual OAuth; select **Verify all connections** for OAuth plus an actual constrained model response. Configured settings are not proof of service access.
2. Create a small USD checkout, open its real approval page and sign in with the separate sandbox buyer. Return and capture the approved order. Compare its amount, currency, order ID and capture ID with PayPal.
3. Set a conservative refund cap/window and enable only **Refund original payments**. Policy templates start disabled.
4. Independently verify the commercial request. In **New message**, select the refund action, trusted order and maximum outside the untrusted message, then confirm that task authority. Submit a matching request you intend to execute. A substituted target/action or excess task amount cannot be authorized by message text.
5. Inspect the decision, canonical original capture, checks, receipt and provider reference. A completed refund requires the provider's `COMPLETED` status. Animation replays recorded evidence; it does not run another payment.
6. Reconcile a known reference to read current provider status without resubmitting. Uncertain actions remain reserved. If no reference was returned, investigate with PayPal using the recorded request identity rather than inventing a new request to bypass the reservation.

Vendor payouts, invoice sending and eligible dispute evidence require separate permissions, genuine records and individual acceptance tests. They are not prerequisites for the demonstrated refund story. The recorded invoice entitlement probe returned `403 NOT_AUTHORIZED`; code presence is not permission or a successful send.

## Evidence already collected

The actual evidence covers OAuth, completed checkout captures, hosted constrained extraction, a completed USD 1.00 refund and an owner-authored forged-authority reattempt held by the remaining-balance check. The post-test PayPal read showed the original capture fully refunded and only the original refund ID. The records retain UTC timestamps and clearly identify sandbox and replay scope.

These recorded hosted decisions were collected before explicit per-request task binding was introduced. Current owner-task enforcement has separate software tests and a [real-model/read-only evaluation](../evaluation/README.md). Do not label a kernel fixture, an evaluation plan or an old simulated benchmark as a newly executed PayPal transaction.

On 29 October, the current hosted task-binding build completed a fresh owner-authorized USD 0.01 sandbox refund. All 17 checks passed. Separate PayPal refund and order GETs confirmed completion on the original capture; all 25 event hashes and previous-hash links in the new private export verified. The [sanitized acceptance report](../evidence/task-bound-refund-verification.json) records the selected task, one-cent ceiling, provider status and internal chain checks. It keeps actor IDs and raw exports private.

## Callback and evidence limitations

The owner-private Site does not establish anonymous webhook delivery. A configured `PAYPAL_WEBHOOK_ID` is not proof that PayPal can reach the callback through private hosting. Authenticated reconciliation is available for recorded references. A separately supported relay/service-access arrangement needs its own delivery verification; broadening owner access is not a callback fix.

An individual decision export includes a creation receipt and the current decision. Its embedded hash does not independently authenticate every later top-level execution field. Use the full authenticated receipt-chain export for complete event continuity checks, and provider reads for actual transaction status. The chain is not externally anchored immutable accounting.

Production payments, multi-tenant operation, the historical public attack arena, baseline comparisons and live Agent Toolkit execution are outside the verified acceptance scope.

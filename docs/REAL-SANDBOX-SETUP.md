# Connect real sandbox services

Custody is not fully verified. The application must call your PayPal sandbox app and your model provider before a successful connection or payment can be claimed. Sandbox records are genuine PayPal test-environment transactions, with no production funds.

## Account setup

1. Open [PayPal Apps & Credentials](https://developer.paypal.com/dashboard/applications/sandbox), sign in and choose **Sandbox**.
2. Use or create a REST app associated with your sandbox business account. Enable the API capabilities you intend to test, including Payouts, Invoicing and Customer Disputes where available.
3. Copy its Client ID and Secret into the ignored `.dev.vars` file in this checkout. Do not put secrets in chat, source control or a browser form.
4. In the deployed Custody app, open **Connections**, copy your authenticated owner ID and set `CUSTODY_SELLER_ID` to that exact value in `.dev.vars`.
5. Configure an HTTPS OpenAI-compatible chat-completions endpoint, its server API key and a model that supports strict JSON schema using `EXTRACTOR_URL`, `EXTRACTOR_KEY` and `EXTRACTOR_MODEL`. There is no rule-parser fallback. If using OpenAI key provisioning through Codex, enable the OpenAI Developers plugin and complete its required authorization.
6. Have the agent transfer these values directly into the Site's server environment as secrets, without displaying their values, then redeploy. Local files do not automatically configure hosting.

Official provider instructions: [PayPal REST onboarding](https://developer.paypal.com/api/get-started/) and [checkout approval/capture](https://developer.paypal.com/api/rest/integration/orders-api).

## Verify real operations

1. Use **Verify connections**. A configured value is not a verified service. Resolve authentication, permission, model and database errors before proceeding.
2. Create a small USD sandbox checkout in Connections. Open its actual PayPal approval URL and approve with a separate sandbox personal buyer account. Return and explicitly capture the approved order. Confirm the provider order and capture IDs in both Custody and PayPal.
3. Add a genuine sandbox recipient to the vendor book and a sandbox customer to the customer book through explicit owner verification. Enable the relevant playbooks and choose conservative caps.
4. Submit your actual request text. Inspect the decision receipt, resolved destination, provider reference and current status. Pending or failed responses do not establish settlement.
5. Verify a refund on the actual captured order. Verify a payout to your sandbox recipient, then reconcile its item status. Verify an invoice reaches the specified sandbox customer. Dispute evidence needs a real eligible sandbox dispute matched to an imported captured order and genuine merchant evidence.
6. Use authenticated reconciliation to refresh recorded provider references. It never re-submits money operations. Ambiguous operations without a known reference require investigation in PayPal; automatic retries are disabled.

The Site is owner-private. PayPal cannot deliver anonymous webhooks through that boundary without supported service access or a separately provisioned relay. The app must not claim webhook delivery is connected solely because a webhook ID exists. Manual authenticated reconciliation supplies an explicit alternative for known references.

## Acceptance evidence still required

Record actual provider IDs, UTC timestamps, outcome statuses and sanitized API response evidence for OAuth, checkout creation/approval/capture, refund, payout, invoice, dispute evidence, duplicate handling and reconciliation. Also verify real model extraction and that its output cannot override canonical destinations. Tests using fixture inputs remain software tests; they are not provider verification.

Full original hackathon scope also includes an independently isolated public sandbox arena, provider-state attack scoring, an ungated baseline comparison and a live Agent Toolkit integration. Those must be separately completed and verified; configuring credentials does not complete them. Production payments are outside the current authorized scope.

# Optional PayPal Agent Toolkit bridge

`lib/toolkit.ts` is a reusable, server-side bridge for **sandbox refunds** through `@paypal/agent-toolkit`. The running application uses the direct REST adapters in `lib/server/paypal.ts`; this optional bridge is not connected to an application route and is not included in the default dependencies.

The bridge accepts a proposed `PaymentPlan`, obtains authoritative records and policy through a trusted host callback, and runs `decide()` itself. It does not accept a caller-approved decision, a tool name, raw SDK arguments, or SDK context. An allow becomes a new payload containing only `capture_id` and the exact USD amount. No requested receiver, alternate capture, note, prompt, extra argument, or source text is forwarded to the Toolkit.

## Install and connect

In a separate server integration or an explicitly enabled project checkout:

```sh
npm install --save-exact @paypal/agent-toolkit@1.11.0
```

The toolkit has its own framework dependencies, including AI SDK 4. Keep that dependency choice out of browser code. This repository does not currently install or run the package; live integration remains unfinished.

```ts
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { createToolkitRefundBridge } from "./lib/toolkit.ts";

const bridge = createToolkitRefundBridge({
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  createToolkit: options => new PayPalAgentToolkit(options),
  // Implement both callbacks in your trusted server host:
  loadAuthority: loadServerOwnedRefundAuthority,
  claimExecution: reserveRefundAtomically,
});

const result = await bridge.execute(proposedPlan);
// "submitted" means the SDK call resolved. Inspect and persist its response,
// then reconcile the refund before treating it as settled.
```

`loadServerOwnedRefundAuthority` must return `{ policy, context }` from authenticated, server-owned stores and a trusted clock. `reserveRefundAtomically` must implement the `ToolkitExecutionClaim` contract: durably reserve the logical `idempotencyKey` once, return `false` for any existing reservation, and retain unknown outcomes for reconciliation. These are required host functions, not included sample implementations. The bridge provides no alternate browser endpoint that could supply them.

Use actual imported sandbox capture records. The bridge rejects seeded `DEMO-*` IDs. Its constructor always configures `context.sandbox: true`; there is no production toggle. It enables `payments.createRefund` only, requires the SDK registry to contain exactly one executable `create_refund` tool, and refuses a changed registry before claiming an action. Every action gets a fresh toolkit instance with a deterministic 38-character `context.request_id`. Errors propagate without retries or releasing the reservation.

## Verified API and deliberate limits

Checked against PayPal's official TypeScript source, reporting package version 1.11.0, on October 25, 2026:

| Surface | Official source |
| --- | --- |
| `@paypal/agent-toolkit/ai-sdk` export and version | [Package manifest](https://github.com/paypal/agent-toolkit/blob/main/typescript/package.json) |
| `new PayPalAgentToolkit({ clientId, clientSecret, configuration })` and `getTools()` | [Toolkit class](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/ai-sdk/toolkit.ts) |
| `create_refund`, enabled by `payments.createRefund` | [Tool registry](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/shared/tools.ts) |
| `capture_id`, optional amount with `currency_code` and decimal `value` | [Refund parameter schema](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/shared/parameters.ts) |
| Refund REST operation | [Shared functions](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/shared/functions.ts) |
| `context.request_id` becomes `PayPal-Request-Id` | [PayPal client](https://github.com/paypal/agent-toolkit/blob/main/typescript/src/shared/client.ts) |

Payouts and dispute evidence are not represented by matching tools in the inspected registry. `send_invoice` acts on an existing invoice ID; it is not interchangeable with Custody's create-and-send flow. This wrapper consequently supports refunds only. The app's direct REST Payouts, invoicing and dispute adapters remain its rails.

The optional package was not installed, bundled, or exercised against PayPal during this build. Tests use the structural toolkit interface and a fake transport; they verify argument isolation, denial paths, registry restrictions, demo-ID rejection, mutation isolation, duplicate claims and ambiguous errors. Runtime checks detect a missing or changed executable surface, but do not replace a sandbox integration test of the installed package.

The guarantee ends at the injected host callbacks and SDK factory. A host that loads model-supplied records as trusted authority, forges ledger claims, exposes credentials, or bypasses this bridge can defeat it. The host must serialize competing refunds against the same capture, revalidate remaining balance when reserving, authenticate callers, persist outcomes and reconcile unknown transactions. This optional module does not add those application lifecycle guarantees or certify arbitrary agent/toolkit code.

Run its offline contract checks with:

```sh
node --experimental-strip-types --test --test-isolation=none tests/toolkit.test.ts
```

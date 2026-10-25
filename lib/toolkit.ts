/**
 * Optional, server-side PayPal Agent Toolkit bridge. The application uses its
 * direct REST adapters; importing this module does not load an optional SDK.
 */
import { createHash } from "node:crypto";
import { decide } from "./kernel.ts";
import type { Decision, KernelContext, PaymentPlan, Policy } from "./kernel.ts";

export interface ToolkitRefundPayload {
  capture_id: string;
  amount: { currency_code: "USD"; value: string };
}
export interface ToolkitOptions {
  clientId: string;
  clientSecret: string;
  configuration: {
    actions: { payments: { createRefund: true } };
    context: { sandbox: true; request_id: string };
  };
}
/** A structural subset of @paypal/agent-toolkit/ai-sdk's public surface. */
export interface ToolkitInstance { getTools(): Record<string, unknown> }
export interface ToolkitExecutionClaim {
  requestId: string;
  idempotencyKey: string;
  tool: "create_refund";
  captureId: string;
  amountCents: number;
  currency: "USD";
}
export interface ToolkitBridgeDependencies {
  clientId: string;
  clientSecret: string;
  createToolkit(options: ToolkitOptions): ToolkitInstance;
  /** Server-owned records, policy and time. Never populate these from a model. */
  loadAuthority(): Promise<{ policy: Policy; context: KernelContext }>;
  /**
   * Atomically reserve this logical action in the host's durable execution
   * ledger. Return false for any existing reservation, including unknown ones.
   * A timeout must remain reserved for reconciliation, never automatic retry.
   */
  claimExecution(claim: ToolkitExecutionClaim): Promise<boolean>;
}
export type ToolkitBridgeResult =
  | { status: "unsupported"; reason: string }
  | { status: "denied"; decision: Decision }
  | { status: "already_claimed"; decision: Decision; requestId: string }
  | { status: "submitted"; decision: Decision; requestId: string; response: unknown };

interface ExecutableTool {
  execute(payload: ToolkitRefundPayload, options: { toolCallId: string; messages: [] }): PromiseLike<unknown> | unknown;
}
function executable(value: unknown): value is ExecutableTool {
  return !!value && typeof value === "object" && "execute" in value && typeof value.execute === "function";
}
function decimal(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * The only input is a proposed plan. There is deliberately no execute(tool,
 * arguments), pre-approved Decision, receiver, configuration or SDK context API.
 * The injected factory, authority loader and ledger are trusted host code.
 */
export function createToolkitRefundBridge(deps: ToolkitBridgeDependencies) {
  if (!deps.clientId.trim() || !deps.clientSecret.trim()) {
    throw new Error("PayPal sandbox client credentials are required.");
  }
  return {
    async execute(proposal: PaymentPlan): Promise<ToolkitBridgeResult> {
      const plan = structuredClone(proposal);
      if (plan.kind !== "refund") {
        return { status: "unsupported", reason: "This optional Toolkit bridge supports refunds only. Use the app's REST adapters for other playbooks." };
      }
      const { policy, context } = structuredClone(await deps.loadAuthority());
      const decision = decide(plan, policy, context);
      if (decision.status !== "allow" || !decision.execution) return { status: "denied", decision };

      // Fresh kernel execution, never the requested capture or arbitrary extras.
      const { captureId, amountCents, currency } = decision.execution.args;
      if (decision.execution.tool !== "paypal.payments.refund"
        || typeof captureId !== "string" || !/^[A-Za-z0-9_-]{15,32}$/.test(captureId)
        || /^DEMO-/i.test(captureId) || currency !== "USD"
        || typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new Error("Kernel execution does not contain a supported sandbox refund. Demo capture IDs cannot be sent to PayPal.");
      }
      const requestId = `custody-${createHash("sha256").update(`toolkit-refund:${decision.execution.idempotencyKey}`).digest("hex").slice(0, 30)}`;
      const payload: ToolkitRefundPayload = Object.freeze({
        capture_id: captureId,
        amount: Object.freeze({ currency_code: "USD" as const, value: decimal(amountCents) }),
      });
      const toolkit = deps.createToolkit({
        clientId: deps.clientId,
        clientSecret: deps.clientSecret,
        configuration: {
          actions: { payments: { createRefund: true } },
          context: { sandbox: true, request_id: requestId },
        },
      });
      const tools = toolkit.getTools();
      // Refuse changed/misconfigured registries instead of exposing extra tools.
      if (Object.keys(tools).length !== 1 || !Object.hasOwn(tools, "create_refund")
        || !executable(tools.create_refund)) {
        throw new Error("Expected exactly one executable PayPal Toolkit tool: create_refund. Verify the installed SDK version.");
      }
      const claimed = await deps.claimExecution(Object.freeze({
        requestId, idempotencyKey: decision.execution.idempotencyKey,
        tool: "create_refund", captureId, amountCents, currency: "USD",
      }));
      if (!claimed) return { status: "already_claimed", decision, requestId };
      // Do not retry here. A rejected/ambiguous call remains the host's reserved
      // action until it is reconciled. A resolved SDK call is not settlement.
      const response = await tools.create_refund.execute(payload, { toolCallId: requestId, messages: [] });
      return { status: "submitted", decision, requestId, response };
    },
  };
}

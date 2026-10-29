import type { Check, Decision, PaymentKind, ProvenanceField, Reason } from "./kernel.ts";

/** Selected by the authenticated merchant outside the quarantined message. */
export interface TaskAuthorization {
  kind: PaymentKind;
  targetId: string;
  maxAmountCents: number;
  confirmed: true;
}
/** The server, never the message or model, records who supplied this task. */
export interface OwnerTaskAuthorization extends TaskAuthorization { by: string; at: string }
const kinds: readonly PaymentKind[] = ["pay_invoice", "refund", "send_invoice", "dispute"];

function validTask(value: unknown): value is TaskAuthorization {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const task = value as Partial<TaskAuthorization>;
  return kinds.includes(task.kind as PaymentKind)
    && typeof task.targetId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(task.targetId)
    && task.confirmed === true && Number.isSafeInteger(task.maxAmountCents)
    && task.maxAmountCents! >= 1 && task.maxAmountCents! <= 1_000_000;
}

/** The request contract intentionally does not accept a caller-supplied actor or timestamp. */
export function parseTaskAuthorization(value: unknown): TaskAuthorization {
  if (!validTask(value) || Object.keys(value).length !== 4
    || !Object.keys(value).every(key => ["kind", "targetId", "maxAmountCents", "confirmed"].includes(key))) {
    throw new TypeError("Select an existing trusted target, a playbook, and a maximum of 1–1,000,000 USD cents; explicitly confirm that you verified and authorize this task.");
  }
  return { kind: value.kind, targetId: value.targetId, maxAmountCents: value.maxAmountCents, confirmed: true };
}

/**
 * A valid destination is necessary, but it does not authorize the model to choose
 * a different valid order/vendor/customer. This independent boundary binds the
 * minimal execution to the task the merchant selected before reading the model.
 */
export function applyTaskAuthorization(decision: Decision, authorization: TaskAuthorization | undefined): Decision {
  const present = validTask(authorization);
  const amount = decision.plan?.args?.amountCents?.value;
  const checks: Check[] = [
    { id: "task_present", label: "Merchant verified this task", passed: present,
      message: "An explicit task selected outside the message must authorize this request." },
    { id: "task_kind", label: "Playbook matches the merchant task", passed: present && decision.plan.kind === authorization.kind,
      message: "The model cannot change the merchant-authorized playbook." },
    { id: "task_target", label: "Target matches the merchant task", passed: present && decision.plan.targetId === authorization.targetId,
      message: "The model cannot select a different order, vendor, customer, or dispute." },
    { id: "task_amount", label: "Within this task's amount ceiling", passed: present && (decision.plan.kind === "dispute"
      || typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 && amount <= authorization.maxAmountCents),
      message: "The amount cannot exceed the ceiling the merchant approved for this task." },
  ];
  const failures: Reason[] = checks.filter(check => !check.passed).map(check => ({ code: check.id, field: "ownerAuthorization", message: check.message }));
  const taskProvenance: ProvenanceField[] = present ? [
    { field: "ownerTask.kind", value: authorization.kind, label: "trusted:approval", source: "Explicit merchant task selection", required: "trusted:approval", authoritative: true },
    { field: "ownerTask.targetId", value: authorization.targetId, label: "trusted:approval", source: "Explicit merchant task selection", required: "trusted:approval", authoritative: true },
    { field: "ownerTask.maxAmountCents", value: authorization.maxAmountCents, label: "trusted:approval", source: "Explicit merchant task selection", required: "trusted:approval", authoritative: true },
  ] : [];
  const { execution, ...withoutExecution } = decision;
  const status = failures.length ? "block" : decision.status;
  return { ...withoutExecution, status, checks: [...decision.checks, ...checks], reasons: [...decision.reasons, ...failures],
    provenance: [...decision.provenance, ...taskProvenance], ...(status === "allow" && execution ? { execution } : {}) };
}

import { labeled } from "./kernel.ts";
import type { KernelContext, Labeled, PaymentKind, PaymentPlan, Policy } from "./kernel.ts";

export interface MessageInput { id?: string; subject?: string; body?: string; from?: string }
export interface ExtractedRequest {
  kind: PaymentKind; requestType: Labeled<PaymentKind>; sourceId: string;
  vendor: Labeled<string>; customer: Labeled<string>; invoiceNumber: Labeled<string>;
  orderId: Labeled<string>; disputeId: Labeled<string>; amountCents: Labeled<number | null>;
  currency: Labeled<string>; requestedReceiver: Labeled<string | null>;
  rawText: string; hostileSpans: string[]; extraction: "deterministic" | "model";
}
function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function capture(text: string, pattern: RegExp): string { return text.match(pattern)?.[1]?.trim() ?? ""; }
function parseCents(text: string): number | null {
  const amountLine = capture(text, /^\s*(?:amount|total|refund amount|invoice total)\s*:\s*(.+)$/im);
  const segment = amountLine || text.match(/-?\$\s*-?\d[\d,]*(?:\.\d+)?/)?.[0] || "";
  const numeric = segment.replace(/\b(?:USD|EUR|GBP|CAD|AUD)\b/gi, "").replace(/\$/g, "").trim();
  if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(numeric)) return null;
  const negative = numeric.startsWith("-");
  const [whole, fraction = ""] = numeric.replace(/^-/, "").replace(/,/g, "").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? (negative ? -result : result) : null;
}
/** Offline quarantined extraction. Every field remains tainted, including IDs. */
export function extractRequest(message: string | MessageInput, explicitSourceId?: string): ExtractedRequest {
  const input = typeof message === "string" ? { body: message } : message;
  const body = input.body ?? "";
  const rawText = [input.subject, body].filter(Boolean).join("\n\n");
  const sourceId = explicitSourceId ?? input.id ?? `message-${fingerprint(rawText)}`;
  const source = `Inbox · ${sourceId}`;
  const taint = <T>(value: T): Labeled<T> => labeled(value, "tainted:email", source);
  const kind: PaymentKind = /\b(?:dispute|chargeback|provide evidence|evidence requested)\b/i.test(rawText) ? "dispute"
    : /\b(?:refund|return request)\b/i.test(rawText) ? "refund"
    : /(?:send|create|draft|raise|issue)\s+(?:(?:our|an?|the|a new)\s+)?(?:wholesale\s+)?invoice/i.test(rawText) ? "send_invoice"
    : "pay_invoice";
  const vendor = capture(body, /^\s*(?:vendor|supplier)\s*:\s*(.+)$/im)
    || capture(rawText, /\b(Acme(?: Packaging(?: Co)?)?|Northstar(?: Supplies| Supply)?|Forma(?: Studio)?|Onyx Logistics)\b/i);
  const customer = capture(body, /^\s*(?:customer|client)\s*:\s*(.+)$/im)
    || capture(rawText, /\b(Maya Chen|Studio Loom|Jordan Ellis)\b/i);
  const invoice = capture(body, /^\s*(?:invoice(?:\s*(?:number|no\.?|#))?)\s*:\s*#?\s*([\w-]+)/im)
    || capture(rawText, /\binvoice\s*(?:#|number\s*:?|no\.?\s*:?|:)\s*([\w-]+)/i);
  const order = capture(rawText, /\b(DEMO-ORDER-[\w-]+)\b/i)
    || capture(body, /^\s*order(?:\s*(?:id|number|#))?\s*:\s*#?\s*([\w-]+)/im);
  const dispute = capture(rawText, /\b(DEMO-DISPUTE-[\w-]+)\b/i)
    || capture(body, /^\s*dispute(?:\s*id)?\s*:\s*([\w-]+)/im);
  const currency = capture(rawText, /\b(USD|EUR|GBP|CAD|AUD)\b/i).toUpperCase() || (rawText.includes("$") ? "USD" : "");
  const emailMatches = body.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const requestedReceiver = capture(body, /(?:receiver|recipient|pay(?:pal)?(?:\s+address)?|send(?:\s+the\s+\$?[\d,.]+)?\s+to|pay\s+to)\s*[:=]?\s*([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)
    || emailMatches.at(-1) || null;
  return {
    kind, requestType: taint(kind), sourceId, vendor: taint(vendor), customer: taint(customer),
    invoiceNumber: taint(invoice), orderId: taint(order), disputeId: taint(dispute),
    amountCents: taint(parseCents(body || rawText)), currency: taint(currency), requestedReceiver: taint(requestedReceiver),
    rawText, extraction: "deterministic",
    hostileSpans: body.split("\n").filter(line => /ignore|override|system|hidden|do not mention|pre-approved|details have changed|bypass|urgent.*(?:pay|send)/i.test(line)),
  };
}
const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
/**
 * Select from the trusted store using tainted claims. Never copy destination
 * addresses, captures, evidence or trusted labels out of the incoming request.
 */
export function resolveRequest(request: ExtractedRequest, context: KernelContext): PaymentPlan {
  const args: PaymentPlan["args"] = {
    amountCents: request.amountCents, currency: request.currency,
    invoiceNumber: request.invoiceNumber, requestType: request.requestType,
  };
  let targetId = "unresolved";
  if (request.kind === "pay_invoice") {
    const claim = normalized(request.vendor.value);
    const vendor = context.vendors.find(v => [v.name, ...v.aliases, v.id].some(name => normalized(name) === claim));
    targetId = vendor?.id ?? `unresolved:${request.vendor.value || "vendor"}`;
    args.vendorClaim = request.vendor;
    args.receiver = vendor ? labeled(vendor.email, "trusted:vendor_book", `Vendor book · ${vendor.name}`)
      : labeled(request.requestedReceiver.value ?? "", "tainted:email", request.requestedReceiver.source);
    if (request.requestedReceiver.value) args.requestedReceiver = request.requestedReceiver;
  } else if (request.kind === "refund") {
    const order = context.orders.find(o => normalized(o.id) === normalized(request.orderId.value));
    targetId = order?.id ?? `unresolved:${request.orderId.value || "order"}`;
    args.orderClaim = request.orderId;
    args.captureId = order ? labeled(order.captureId, "trusted:paypal", `Order store · ${order.id}`)
      : labeled("", "tainted:email", request.orderId.source);
    if (request.requestedReceiver.value) args.requestedReceiver = request.requestedReceiver;
  } else if (request.kind === "send_invoice") {
    const claim = normalized(request.customer.value);
    const customer = context.customers.find(c => [c.name, c.id].some(name => normalized(name) === claim));
    targetId = customer?.id ?? `unresolved:${request.customer.value || "customer"}`;
    args.customerClaim = request.customer;
    args.recipient = customer ? labeled(customer.email, "trusted:customer_book", `Customer book · ${customer.name}`)
      : labeled(request.requestedReceiver.value ?? "", "tainted:email", request.requestedReceiver.source);
    if (request.requestedReceiver.value) args.requestedReceiver = request.requestedReceiver;
  } else if (request.kind === "dispute") {
    const dispute = context.disputes.find(d => normalized(d.id) === normalized(request.disputeId.value));
    const order = context.orders.find(o => o.id === dispute?.orderId);
    targetId = dispute?.id ?? `unresolved:${request.disputeId.value || "dispute"}`;
    args.disputeClaim = request.disputeId;
    args.disputeId = dispute ? labeled(dispute.id, "trusted:paypal", `Dispute store · ${dispute.id}`)
      : labeled(request.disputeId.value, "tainted:email", request.disputeId.source);
    args.captureId = order ? labeled(order.captureId, "trusted:paypal", `Order store · ${order.id}`)
      : labeled("", "tainted:email", request.orderId.source);
  }
  return { kind: request.kind, targetId, sourceId: request.sourceId, args };
}
export function policyFor(kind: PaymentKind, policies: readonly Policy[]): Policy {
  const policy = policies.find(p => p.kind === kind);
  if (!policy) throw new Error(`No standing policy exists for ${kind}.`);
  return policy;
}
export const extract = extractRequest;
export const resolve = resolveRequest;

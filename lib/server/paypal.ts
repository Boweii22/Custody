import type { Execution, Order } from "../kernel";
import { HttpError, runtime } from "./runtime";
import { sha256 } from "./store";
import { exactPayPalCents } from "./reconciliation";
import { hasSandboxCredentials } from "./configuration";

// Hard-coded sandbox origin. No browser, environment override, or model output
// can select a production host or provide an arbitrary HTTP tool/path.
const BASE = "https://api-m.sandbox.paypal.com";
type Dict = Record<string, unknown>;
function object(value: unknown): Dict { return value && typeof value === "object" ? value as Dict : {}; }
function list(value: unknown): Dict[] { return Array.isArray(value) ? value.map(object) : []; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function cents(value: unknown): number {
  const amount = exactPayPalCents(value);
  if (amount === undefined) throw new HttpError(502, "PayPal returned an unsupported monetary value.");
  return amount;
}
function money(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new HttpError(400, "An exact positive amount in cents is required.");
  return ((value as number) / 100).toFixed(2);
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(value) || value.startsWith("DEMO-")) throw new HttpError(409, "Import an actual PayPal sandbox record before executing this action.");
  return encodeURIComponent(value);
}
let cachedToken: { token: string; expires: number; credential: string } | undefined;
export function sandboxConfigured(): boolean { const env = runtime(); return env.CUSTODY_RAIL === "sandbox" && hasSandboxCredentials(env); }
export async function oauth(forceRefresh = false): Promise<string> {
  const env = runtime();
  if (!sandboxConfigured()) throw new HttpError(503, "Configure genuine sandbox credentials and CUSTODY_RAIL=sandbox on the server.");
  if (!forceRefresh && cachedToken && cachedToken.credential === `${env.PAYPAL_CLIENT_ID}\0${env.PAYPAL_CLIENT_SECRET}` && cachedToken.expires > Date.now()) return cachedToken.token;
  let response: Response;
  try {
    response = await fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(12000) });
  } catch { throw new HttpError(502, "PayPal sandbox OAuth is unavailable."); }
  const data = object(await response.json());
  if (!response.ok || !data.access_token) throw new HttpError(502, "PayPal sandbox authentication failed. Check the server credentials.");
  cachedToken = { token: text(data.access_token), expires: Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000, credential: `${env.PAYPAL_CLIENT_ID}\0${env.PAYPAL_CLIENT_SECRET}` };
  return cachedToken.token;
}
async function api(path: string, method = "GET", body?: unknown, requestId?: string, multipart = false): Promise<Dict> {
  const token = await oauth();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Prefer: "return=representation" };
  if (!multipart) headers["Content-Type"] = "application/json";
  if (requestId) headers["PayPal-Request-Id"] = requestId.slice(0, 108);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: multipart ? body as FormData : JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  } catch { throw new HttpError(502, "PayPal sandbox response is uncertain. The action stays reserved for manual reconciliation; it will not be retried automatically."); }
  const raw = await response.text();
  let data: Dict = {};
  try { data = raw ? object(JSON.parse(raw)) : {}; } catch { throw new HttpError(502, "PayPal returned an unreadable response; reconcile the reserved action manually."); }
  if (!response.ok) {
    console.error(JSON.stringify({ event: "paypal.sandbox.error", status: response.status, name: text(data.name), debugId: text(data.debug_id) }));
    throw new HttpError(502, `PayPal sandbox declined the request (${response.status}). Check the sandbox account and reconcile the reserved action.`);
  }
  return data;
}
export type RailResult = { mode: "sandbox"; reference: string; status: string; secondaryReference?: string };
export async function executeSandbox(execution: Execution): Promise<RailResult> {
  if (runtime().CUSTODY_RAIL !== "sandbox") throw new HttpError(409, "Sandbox execution is disabled by the server.");
  const args = execution.args;
  const key = `CUSTODY-${(await sha256(execution.idempotencyKey)).slice(0, 48)}`;
  if (execution.tool === "paypal.payouts.create") {
    const receiver = text(args.receiver);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiver) || /\.(example|test|demo)$/i.test(receiver)) throw new HttpError(409, "Use an explicitly verified real sandbox recipient address.");
    const data = await api("/v1/payments/payouts", "POST", {
      sender_batch_header: { sender_batch_id: key, email_subject: "Custody vendor payment" },
      items: [{ recipient_type: "EMAIL", receiver, amount: { value: money(args.amountCents), currency: "USD" }, sender_item_id: key, note: `Invoice ${text(args.invoiceNumber).slice(0, 80)}` }],
    }, key);
    const header = object(data.batch_header);
    identifier(header.payout_batch_id);
    return { mode: "sandbox", reference: text(header.payout_batch_id), status: text(header.batch_status) || "PENDING" };
  }
  if (execution.tool === "paypal.payments.refund") {
    const data = await api(`/v2/payments/captures/${identifier(args.captureId)}/refund`, "POST", { amount: { value: money(args.amountCents), currency_code: "USD" }, custom_id: key, note_to_payer: "Refund under the seller's Custody playbook" }, key);
    identifier(data.id);
    if (cents(object(data.amount).value) !== args.amountCents || object(data.amount).currency_code !== "USD") throw new HttpError(502, "PayPal refund amount or currency differs from the authorized action. Reconcile before taking further action.");
    return { mode: "sandbox", reference: text(data.id), status: text(data.status) || "PENDING" };
  }
  if (execution.tool === "paypal.invoicing.send") {
    const recipient = text(args.recipient);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || /\.(example|test|demo)$/i.test(recipient)) throw new HttpError(409, "Import an explicitly verified sandbox customer address first.");
    const invoiceNumber = text(args.invoiceNumber);
    if (!invoiceNumber || invoiceNumber.length > 25) throw new HttpError(400, "PayPal invoice references must contain 1–25 characters.");
    const data = await api("/v2/invoicing/invoices", "POST", {
      detail: { invoice_number: invoiceNumber, currency_code: "USD", memo: key, payment_term: { term_type: "DUE_ON_RECEIPT" } },
      primary_recipients: [{ billing_info: { email_address: recipient } }],
      items: [{ name: "Professional services", quantity: "1", unit_amount: { currency_code: "USD", value: money(args.amountCents) } }],
    }, `${key}-draft`);
    const id = text(data.id);
    if (!id) throw new HttpError(502, "PayPal draft did not include an ID. Reconcile the reserved action manually.");
    await api(`/v2/invoicing/invoices/${identifier(id)}/send`, "POST", { send_to_invoicer: true, send_to_recipient: true }, `${key}-send`);
    const confirmed = await getSandboxInvoice(id);
    return { mode: "sandbox", reference: id, status: text(confirmed.status) || "UNKNOWN" };
  }
  if (execution.tool === "paypal.disputes.provide_evidence") {
    const id = identifier(args.disputeId);
    const dispute = await api(`/v1/customer/disputes/${id}`);
    if (!list(dispute.links).some(link => link.rel === "provide-evidence")) throw new HttpError(409, "PayPal does not currently permit evidence for this dispute.");
    if (!list(dispute.disputed_transactions).some(value => value.seller_transaction_id === args.captureId)) throw new HttpError(409, "PayPal dispute capture differs from the authorized original payment.");
    const requested = list(dispute.evidences).filter(value => value.source === "REQUESTED_FROM_SELLER");
    if (!requested.some(value => value.evidence_type === "PROOF_OF_FULFILLMENT")) throw new HttpError(409, "PayPal has not requested fulfillment evidence for this dispute. Other evidence types are not supported.");
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify({ evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: text(args.carrier), tracking_number: text(args.trackingNumber) }] }, notes: `Merchant delivery record: ${text(args.deliveredAt)}. Capture ${text(args.captureId)}.` }] })], { type: "application/json" }));
    await api(`/v1/customer/disputes/${id}/provide-evidence`, "POST", form, key, true);
    return { mode: "sandbox", reference: text(args.disputeId), status: "EVIDENCE_SUBMITTED" };
  }
  throw new HttpError(400, "Unsupported rail operation.");
}
export type ImportedOrder = Order & { refundIds: string[] };
export async function getSandboxOrder(orderId: string): Promise<ImportedOrder> {
  const data = await api(`/v2/checkout/orders/${identifier(orderId)}`);
  if (data.id !== orderId) throw new HttpError(502, "PayPal returned an unexpected order identity.");
  const units = list(data.purchase_units);
  const captures = units.flatMap(unit => list(object(unit.payments).captures));
  if (captures.length !== 1) throw new HttpError(409, "This workspace supports orders with exactly one capture.");
  const capture = captures[0];
  identifier(capture.id);
  if (!Number.isFinite(Date.parse(text(capture.create_time)))) throw new HttpError(502, "PayPal returned an invalid capture timestamp.");
  const amount = object(capture.amount);
  const refunds = units.flatMap(unit => list(object(unit.payments).refunds));
  const completedRefunds = refunds.filter(refund => refund.status === "COMPLETED");
  let refundedCents = completedRefunds.reduce((total, refund) => total + cents(object(refund.amount).value), 0);
  const status = text(capture.status);
  if (status === "REFUNDED") refundedCents = cents(amount.value);
  if (status === "PARTIALLY_REFUNDED" && refunds.length === 0) throw new HttpError(409, "Partial-refund history is unavailable; reconcile the capture before refunding again.");
  const payer = Object.keys(object(data.payer)).length ? object(data.payer) : object(object(data.payment_source).paypal);
  return { refundIds: completedRefunds.map(refund => text(refund.id)).filter(Boolean), id: text(data.id), customerId: text(payer.payer_id), customerName: [text(object(payer.name).given_name), text(object(payer.name).surname)].filter(Boolean).join(" ") || "Sandbox customer", captureId: text(capture.id), capturedCents: cents(amount.value), refundedCents, currency: text(amount.currency_code), capturedAt: text(capture.create_time), paymentStatus: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(status) ? "COMPLETED" : "PENDING", description: text(units[0]?.description) || "Imported PayPal sandbox order" };
}
export async function getSandboxDispute(id: string) {
  const result = await api(`/v1/customer/disputes/${identifier(id)}`);
  if (result.dispute_id !== id) throw new HttpError(502, "PayPal returned an unexpected dispute identity.");
  return result;
}
export async function createSandboxOrder(amountCents: number, requestId: string, origin: string) {
  return api("/v2/checkout/orders", "POST", { intent: "CAPTURE", payment_source: { paypal: { experience_context: { payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", return_url: `${origin}/?checkout=approved`, cancel_url: `${origin}/?checkout=cancelled` } } }, purchase_units: [{ amount: { currency_code: "USD", value: money(amountCents) }, description: "Custody sandbox storefront" }] }, requestId);
}
export async function getSandboxCheckoutOrder(id: string) { return api(`/v2/checkout/orders/${identifier(id)}`); }
export async function captureSandboxOrder(id: string, requestId: string) { return api(`/v2/checkout/orders/${identifier(id)}/capture`, "POST", {}, requestId); }
export async function getSandboxPayout(id: string) { return api(`/v1/payments/payouts/${identifier(id)}?page_size=1000`); }
export async function getSandboxRefund(id: string) { return api(`/v2/payments/refunds/${identifier(id)}`); }
export async function getSandboxInvoice(id: string) { return api(`/v2/invoicing/invoices/${identifier(id)}`); }
export async function verifySandboxWebhook(request: Request, event: unknown): Promise<boolean> {
  const webhookId = runtime().PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const result = await api("/v1/notifications/verify-webhook-signature", "POST", {
    auth_algo: request.headers.get("paypal-auth-algo"), cert_url: request.headers.get("paypal-cert-url"), transmission_id: request.headers.get("paypal-transmission-id"), transmission_sig: request.headers.get("paypal-transmission-sig"), transmission_time: request.headers.get("paypal-transmission-time"), webhook_id: webhookId, webhook_event: event,
  });
  return result.verification_status === "SUCCESS";
}

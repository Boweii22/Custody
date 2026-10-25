import type { Policy } from "../kernel.ts";

export type ConnectionEnvironment = {
  CUSTODY_RAIL?: string; CUSTODY_SELLER_ID?: string;
  PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_WEBHOOK_ID?: string;
  EXTRACTOR_URL?: string; EXTRACTOR_KEY?: string; EXTRACTOR_MODEL?: string;
};
export type ConnectionCheck = { id: string; label: string; status: "ready" | "missing" | "unverified"; detail: string };
export type ConnectionVerification = { fingerprint: string; at: string };
export const operatingMode = (env: ConnectionEnvironment): "unconfigured" | "sandbox" => env.CUSTODY_RAIL === "sandbox" ? "sandbox" : "unconfigured";
export const hasSandboxCredentials = (env: ConnectionEnvironment) => !!(env.PAYPAL_CLIENT_ID?.trim() && env.PAYPAL_CLIENT_SECRET?.trim());
export const hasExtractorCredentials = (env: ConnectionEnvironment) => {
  if (!env.EXTRACTOR_URL || !env.EXTRACTOR_KEY?.trim() || !env.EXTRACTOR_MODEL?.trim()) return false;
  try { const url = new URL(env.EXTRACTOR_URL); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
};
export function missingExecutionConfiguration(env: ConnectionEnvironment): string[] {
  return [operatingMode(env) !== "sandbox" ? "CUSTODY_RAIL=sandbox" : "", !hasSandboxCredentials(env) ? "PayPal sandbox credentials" : "", !env.CUSTODY_SELLER_ID?.trim() ? "authenticated seller identity" : "", !hasExtractorCredentials(env) ? "HTTPS model endpoint, key, and model" : ""].filter(Boolean);
}
/** Templates are standing policies, never fabricated merchant/payment records. */
export function initialPolicies(): Policy[] {
  return [
    { id: "policy-vendors", name: "Pay verified vendors", version: 1, kind: "pay_invoice", enabled: false, maxAmountCents: 50000, currency: "USD", description: "Pay verified vendor-book recipients up to your explicit allowance. Disabled until you enable it." },
    { id: "policy-refunds", name: "Refund original payments", version: 1, kind: "refund", enabled: false, maxAmountCents: 25000, currency: "USD", refundWindowDays: 30, description: "Refund only the original PayPal capture within the remaining captured amount. Disabled until enabled." },
    { id: "policy-invoice", name: "Invoice verified customers", version: 1, kind: "send_invoice", enabled: false, maxAmountCents: 250000, currency: "USD", description: "Send actual sandbox invoices only to verified customer-book recipients. Disabled until enabled." },
    { id: "policy-dispute", name: "Submit fulfillment evidence", version: 1, kind: "dispute", enabled: false, maxAmountCents: 1, currency: "USD", description: "Submit recorded shipping evidence only when PayPal requests fulfillment evidence. Disabled until enabled." },
  ];
}

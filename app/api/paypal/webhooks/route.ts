import { HttpError, json, railMode, readJson, runtime } from "@/lib/server/runtime";
import { verifySandboxWebhook } from "@/lib/server/paypal";
import { reconcileWebhook } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";

// PayPal is the authenticated principal for this endpoint. No browser Origin or
// SIWC bypass is accepted. Signature verification is mandatory on EVERY delivery.
export async function POST(request: Request) {
  try {
    if (railMode() !== "sandbox" || !runtime().PAYPAL_WEBHOOK_ID) throw new HttpError(503, "Sandbox webhooks are not configured.");
    for (const header of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) {
      if (!request.headers.get(header)) throw new HttpError(401, "Missing PayPal signature headers.");
    }
    await rateLimit(`webhook:${request.headers.get("cf-connecting-ip") ?? "unattributed"}`, 120);
    const event = await readJson(request);
    if (!await verifySandboxWebhook(request, event)) throw new HttpError(401, "Invalid PayPal webhook signature.");
    return json(await reconcileWebhook(event));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(JSON.stringify({ event: "paypal.webhook.failed", kind: error instanceof Error ? error.name : "UnknownError" }));
    return json({ error: "Webhook reconciliation failed. Retry delivery; event IDs are idempotent." }, 500);
  }
}

import { database, endpoint, railMode } from "@/lib/server/runtime";
import { oauth, sandboxConfigured } from "@/lib/server/paypal";
import { extractorConfigured } from "@/lib/server/extraction";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    await database().prepare("SELECT 1 AS healthy").first();
    const mode = railMode();
    let paypal = mode === "demo" ? "not called in demo mode" : "not configured";
    if (mode === "sandbox" && sandboxConfigured()) { await oauth(); paypal = "sandbox OAuth verified"; }
    return { status: "ok", database: "connected", mode, paypal, extractor: extractorConfigured() ? "configured; checked on extraction" : "deterministic rule demo", arena: "isolated simulation; payment rail disabled" };
  });
}

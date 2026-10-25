import { database, endpoint, railMode } from "@/lib/server/runtime";
import { appState } from "@/lib/server/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(request, async user => {
    await database().prepare("SELECT 1 AS healthy").first();
    const state = await appState(user);
    return { status: "ok", database: "connected", mode: railMode(), readiness: state.readiness, capabilities: state.capabilities, paypal: "Use the explicit connection verification action to perform real OAuth.", extractor: state.extractor, arena: "disabled; no simulated execution" };
  });
}

import { endpoint, readJson } from "@/lib/server/runtime";
import { ensureLedger, reviewDecision } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async user => {
    const { id } = await context.params;
    const body = await readJson(request);
    await ensureLedger();
    await rateLimit(`review:${user.id}`, 30);
    return reviewDecision(id, body.action, user);
  }, true);
}

import { endpoint, readJson } from "@/lib/server/runtime";
import { ensureLedger, reconcileDecisions } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request) {
  return endpoint(request, async user => {
    const body = await readJson(request);
    await ensureLedger();
    await rateLimit(`reconcile:${user.id}`, 10);
    return reconcileDecisions(body, user);
  }, true);
}

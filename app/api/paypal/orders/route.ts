import { endpoint, readJson } from "@/lib/server/runtime";
import { checkoutOperation, ensureLedger } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request) {
  return endpoint(request, async user => {
    const body = await readJson(request);
    await ensureLedger();
    await rateLimit(`checkout:${user.id}`, 20);
    return checkoutOperation(body, user, new URL(request.url).origin);
  }, true);
}

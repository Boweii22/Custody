import { endpoint, HttpError, readJson } from "@/lib/server/runtime";
import { ensureLedger, verifyConnections } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request) {
  return endpoint(request, async user => {
    const body = await readJson(request);
    if (body.scope !== undefined && body.scope !== "all" && body.scope !== "paypal") throw new HttpError(400, "Choose verification scope all or paypal.");
    await ensureLedger();
    await rateLimit(`connections:${user.id}`, 5);
    return verifyConnections(user, body.scope !== "paypal");
  }, true);
}

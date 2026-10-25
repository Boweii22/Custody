import { endpoint, readJson } from "@/lib/server/runtime";
import { ensureLedger, importDispute, importOrder } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request) {
  return endpoint(request, async user => {
    const body = await readJson(request);
    await ensureLedger();
    await rateLimit(`records:${user.id}`, 30);
    return body.disputeId !== undefined ? importDispute(body.disputeId, user) : importOrder(body.orderId, user);
  }, true);
}

import { endpoint } from "@/lib/server/runtime";
import { ensureLedger, verifyConnections } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request) {
  return endpoint(request, async user => {
    await ensureLedger();
    await rateLimit(`connections:${user.id}`, 5);
    return verifyConnections(user);
  }, true);
}

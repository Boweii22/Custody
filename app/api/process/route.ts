import { endpoint, readJson } from "@/lib/server/runtime";
import { ensureLedger, processMessage } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request) {
  return endpoint(request, async user => {
    const body = await readJson(request);
    await ensureLedger();
    await rateLimit(`process:${user.id}`, user.local ? 150 : 60);
    if (body.arena === true) await rateLimit(`arena:${request.headers.get("cf-connecting-ip") ?? user.id}`, user.local ? 120 : 20);
    return processMessage(body, user);
  }, true);
}

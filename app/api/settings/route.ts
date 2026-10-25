import { endpoint, readJson } from "@/lib/server/runtime";
import { ensureLedger, updateSettings } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/store";
export async function POST(request: Request) {
  return endpoint(request, async user => {
    const body = await readJson(request);
    await ensureLedger();
    await rateLimit(`settings:${user.id}`, 30);
    return updateSettings(body, user);
  }, true);
}

import { endpoint } from "@/lib/server/runtime";
import { appState } from "@/lib/server/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return endpoint(request, user => appState(user)); }

import { endpoint } from "@/lib/server/runtime";
import { exportReceiptChain } from "@/lib/server/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return endpoint(request, user => exportReceiptChain(user)); }

import { env } from "cloudflare:workers";

export type Runtime = Cloudflare.Env & {
  CUSTODY_RAIL?: string;
  CUSTODY_SELLER_ID?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  EXTRACTOR_URL?: string;
  EXTRACTOR_KEY?: string;
  EXTRACTOR_MODEL?: string;
};
export function runtime(): Runtime { return env as Runtime; }
export function database(): D1Database {
  const db = runtime().DB;
  if (!db) throw new HttpError(503, "Persistent ledger unavailable. Configure the DB binding and apply migrations.");
  return db;
}
export function railMode(): "demo" | "sandbox" { return runtime().CUSTODY_RAIL === "sandbox" ? "sandbox" : "demo"; }
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Identity = { id: string; name: string; email: string; local: boolean };
export async function identity(request: Request): Promise<Identity> {
  const url = new URL(request.url);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  let user: Identity;
  if (id && email) {
    let name = email;
    try { name = decodeURIComponent(request.headers.get("oai-authenticated-user-full-name") ?? email); } catch { /* Display-only field. */ }
    user = { id, email, name, local };
  } else if (local && railMode() === "demo") {
    user = { id: "local-demo", name: "Bowei", email: "seller@custody.demo", local: true };
  } else throw new HttpError(401, "Sign in with ChatGPT to open this seller ledger.");
  const seller = runtime().CUSTODY_SELLER_ID;
  if (seller && user.id !== seller) throw new HttpError(403, "This identity is not the configured seller.");
  if (railMode() === "sandbox" && (!seller || user.id !== seller)) throw new HttpError(503, "Sandbox execution requires a configured authenticated seller identity.");
  if (!local && !seller) {
    // The Site is provisioned owner-private. Bind its first authenticated owner
    // durably so later private sharing does not grant control of seller records.
    // Never make this Site public before explicitly setting the seller ID.
    const db = database();
    await db.prepare("INSERT OR IGNORE INTO custody_state (id, payload, version, updated_at) VALUES (?, ?, 0, ?)").bind("seller-owner-v1", JSON.stringify({ id: user.id }), new Date().toISOString()).run();
    const row = await db.prepare("SELECT payload FROM custody_state WHERE id = ?").bind("seller-owner-v1").first<{ payload: string }>();
    if (!row || (JSON.parse(row.payload) as { id: string }).id !== user.id) throw new HttpError(403, "This private ledger belongs to a different seller.");
  }
  return user;
}
export function sameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new HttpError(403, "A same-origin request is required.");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site mutations are disabled.");
  if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Send application/json.");
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > 18000) throw new HttpError(413, "Request exceeds 18 KB.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A JSON body is required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 18000) { await reader.cancel(); throw new HttpError(413, "Request exceeds 18 KB."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("object required");
    return value;
  } catch { throw new HttpError(400, "Invalid JSON object."); }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function endpoint(request: Request, fn: (user: Identity) => Promise<unknown>, mutate = false): Promise<Response> {
  try {
    if (mutate) sameOrigin(request);
    return json(await fn(await identity(request)));
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(JSON.stringify({ event: "custody.request.failed", kind: error instanceof Error ? error.name : "UnknownError" }));
    return json({ error: "The ledger could not complete this request. No automatic retry was sent to PayPal." }, 500);
  }
}

import { database, HttpError } from "./runtime";
import type { ConnectionVerification } from "./configuration";

export type ChainReceipt = { index: number; at: string; previousHash: string; hash: string; event: string; data: unknown };
export type PayPalOperation = {
  id: string; kind: "create_order" | "capture_order"; key: string; actor: string;
  status: "reserved" | "completed" | "failed"; createdAt: string;
  orderId?: string; amountCents?: number; result?: Record<string, unknown>; error?: string;
};
export type LedgerState = {
  schemaVersion: 1; vendors: unknown[]; customers: unknown[]; orders: unknown[];
  disputes: unknown[]; policies: unknown[]; decisions: unknown[]; receipts: ChainReceipt[];
  paypalOperations?: PayPalOperation[];
  webhookEvents?: string[];
  connectionVerifications?: { paypal?: ConnectionVerification; extractor?: ConnectionVerification };
};
// Keep the historical fictional ledger untouched; it is never read operationally.
const KEY = "seller-ledger-real-v1";
const GENESIS = "0".repeat(64);
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
export async function sha256(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, "0")).join("");
}
export async function appendReceipt(state: LedgerState, event: string, data: unknown, at = new Date().toISOString()): Promise<ChainReceipt> {
  const base = { index: state.receipts.length + 1, at, previousHash: state.receipts.at(-1)?.hash ?? GENESIS, event, data };
  const receipt = { ...base, hash: await sha256(canonical(base)) };
  state.receipts.push(receipt);
  return receipt;
}
export async function verifyChain(state: LedgerState) {
  let previous = GENESIS;
  for (let index = 0; index < state.receipts.length; index++) {
    const { hash, ...base } = state.receipts[index];
    if (base.index !== index + 1 || base.previousHash !== previous || await sha256(canonical(base)) !== hash) return { verified: false, count: state.receipts.length, head: state.receipts.at(-1)?.hash ?? GENESIS };
    previous = hash;
  }
  return { verified: true, count: state.receipts.length, head: previous };
}
export async function initialize(seed: () => Promise<LedgerState>): Promise<void> {
  const db = database();
  if (await db.prepare("SELECT id FROM custody_state WHERE id = ?").bind(KEY).first()) return;
  const state = await seed();
  await db.prepare("INSERT OR IGNORE INTO custody_state (id, payload, version, updated_at) VALUES (?, ?, 0, ?)").bind(KEY, JSON.stringify(state), new Date().toISOString()).run();
}
export async function readState(): Promise<{ state: LedgerState; version: number }> {
  const row = await database().prepare("SELECT payload, version FROM custody_state WHERE id = ?").bind(KEY).first<{ payload: string; version: number }>();
  if (!row) throw new HttpError(503, "The ledger has not been initialized.");
  return { state: JSON.parse(row.payload) as LedgerState, version: row.version };
}
// Pure callbacks may run again after contention. CAS reserves execution before
// network calls; retries can never resubmit an already reserved payment.
export async function mutateState<T>(change: (state: LedgerState) => Promise<T> | T): Promise<T> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const { state, version } = await readState();
    const result = await change(state);
    const payload = JSON.stringify(state);
    if (new TextEncoder().encode(payload).byteLength > 1_700_000) throw new HttpError(507, "Ledger storage is full. Export and archive it before adding more receipts.");
    const updated = await database().prepare("UPDATE custody_state SET payload = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(payload, new Date().toISOString(), KEY, version).run();
    if (updated.meta.changes === 1) return result;
  }
  throw new HttpError(409, "The ledger is busy. Retry the request; reserved payments remain idempotent.");
}
export async function rateLimit(key: string, limit: number, seconds = 60): Promise<void> {
  const id = await sha256(key);
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const row = await database().prepare("INSERT INTO custody_rate_limits (id, bucket, count) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN bucket = excluded.bucket THEN count + 1 ELSE 1 END, bucket = excluded.bucket RETURNING count").bind(id, bucket).first<{ count: number }>();
  if (!row || row.count > limit) throw new HttpError(429, "Rate limit reached. Give the ledger a moment and try again.");
}

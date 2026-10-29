/** Local sandbox access is an explicit own-account opt-in, never platform identity. */
export interface LocalSandboxConfiguration {
  CUSTODY_LOCAL_SANDBOX?: string;
  CUSTODY_LOCAL_AUTH_TOKEN?: string;
  CUSTODY_SELLER_ID?: string;
}
type LocalRequest = { url: string; headers: Pick<Headers, "get"> };

export function isLoopbackURL(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

/** Always compares the same 64 character positions; no matching-prefix exit. */
export function fixedWorkTokenEqual(expected: string, supplied: string): boolean {
  let difference = (expected.length ^ 64) | (supplied.length ^ 64);
  for (let index = 0; index < 64; index++) difference |= (expected.charCodeAt(index) || 0) ^ (supplied.charCodeAt(index) || 0);
  return difference === 0;
}

export function localSandboxConfigured(url: string, configuration: LocalSandboxConfiguration): boolean {
  const seller = configuration.CUSTODY_SELLER_ID;
  return isLoopbackURL(url) && configuration.CUSTODY_LOCAL_SANDBOX === "enabled"
    && typeof configuration.CUSTODY_LOCAL_AUTH_TOKEN === "string" && /^[a-f0-9]{64}$/.test(configuration.CUSTODY_LOCAL_AUTH_TOKEN)
    && typeof seller === "string" && seller.length > 0 && seller.length <= 200 && seller === seller.trim();
}

export function localSandboxAuthorized(request: LocalRequest, configuration: LocalSandboxConfiguration): boolean {
  // URL is supplied by the bound server; forwarded/Host/platform-auth headers are
  // intentionally not consulted. A hosted Site can never enable this branch.
  return localSandboxConfigured(request.url, configuration)
    && fixedWorkTokenEqual(configuration.CUSTODY_LOCAL_AUTH_TOKEN!, request.headers.get("X-Custody-Local-Token") ?? "");
}

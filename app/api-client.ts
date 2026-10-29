// Kept in the current browser tab's memory only. Never persisted or put in a URL.
let localSandboxToken = '';

export function isLocalSandboxBrowser(): boolean {
    return typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

export function setLocalSandboxToken(value: string): void {
    if (isLocalSandboxBrowser()) localSandboxToken = value.trim();
}

export function clearLocalSandboxToken(): void { localSandboxToken = ''; }

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (isLocalSandboxBrowser() && localSandboxToken) {
        const target = new URL(path, window.location.href);
        if (target.origin === window.location.origin && target.pathname.startsWith('/api/')) {
            headers.set('X-Custody-Local-Token', localSandboxToken);
        }
    }
    return fetch(path, { ...init, headers });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, clearLocalSandboxToken, isLocalSandboxBrowser, setLocalSandboxToken } from '../app/api-client.ts';

test('local access token is confined to loopback same-origin API requests and clears on lock', async t => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const calls: Array<{ path: string; headers: Headers }> = [];
    const location = (url: string) => Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: new URL(url) } });
    t.mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => {
        calls.push({ path, headers: new Headers(init?.headers) });
        return Response.json({});
    });
    t.after(() => {
        clearLocalSandboxToken();
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else Reflect.deleteProperty(globalThis, 'window');
    });

    location('http://127.0.0.1:4381/');
    assert.equal(isLocalSandboxBrowser(), true);
    clearLocalSandboxToken();
    await apiFetch('/api/state');
    assert.equal(calls.at(-1)?.headers.has('X-Custody-Local-Token'), false);

    setLocalSandboxToken('local-test-token');
    await apiFetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(calls.at(-1)?.headers.get('X-Custody-Local-Token'), 'local-test-token');
    assert.equal(calls.at(-1)?.headers.get('Content-Type'), 'application/json');

    for (const path of ['/judge', 'https://example.com/api/state', '//example.com/api/state', 'http://127.0.0.1:9000/api/state']) {
        await apiFetch(path);
        assert.equal(calls.at(-1)?.headers.has('X-Custody-Local-Token'), false, `token must not be sent to ${path}`);
    }

    location('https://custody.example.com/');
    assert.equal(isLocalSandboxBrowser(), false);
    await apiFetch('/api/state');
    assert.equal(calls.at(-1)?.headers.has('X-Custody-Local-Token'), false);

    location('http://[::1]:4381/');
    assert.equal(isLocalSandboxBrowser(), true);
    clearLocalSandboxToken();
    await apiFetch('/api/state');
    assert.equal(calls.at(-1)?.headers.has('X-Custody-Local-Token'), false);

    location('https://localhost.example.com/');
    setLocalSandboxToken('must-not-be-retained');
    location('http://localhost:4381/');
    await apiFetch('/api/state');
    assert.equal(calls.at(-1)?.headers.has('X-Custody-Local-Token'), false);
});

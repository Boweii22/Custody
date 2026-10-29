import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fixedWorkTokenEqual, isLoopbackURL, localSandboxAuthorized, localSandboxConfigured } from "../lib/local-authority.ts";
import { judgeEnvironmentContent, setupJudgeEnvironment } from "../scripts/setup-judge.mjs";

const token = "a".repeat(64);
const configuration = { CUSTODY_LOCAL_SANDBOX: "enabled", CUSTODY_LOCAL_AUTH_TOKEN: token, CUSTODY_SELLER_ID: "local-owner" };
const request = (url: string, supplied?: string, extra: Record<string, string> = {}) => new Request(url, { headers: { ...(supplied ? { "X-Custody-Local-Token": supplied } : {}), ...extra } });

test("explicit local sandbox access requires the exact token and all opt-in configuration", () => {
  for (const url of ["http://127.0.0.1:4381/api/state", "http://localhost:4381/api/state", "http://[::1]:4381/api/state"]) {
    assert.equal(localSandboxConfigured(url, configuration), true);
    assert.equal(localSandboxAuthorized(request(url, token), configuration), true);
    for (const supplied of [undefined, "", "a".repeat(63), "a".repeat(65), "a".repeat(63) + "b", "b" + "a".repeat(63), token.toUpperCase()]) assert.equal(localSandboxAuthorized(request(url, supplied), configuration), false);
    for (const config of [
      {}, { ...configuration, CUSTODY_LOCAL_SANDBOX: undefined }, { ...configuration, CUSTODY_LOCAL_SANDBOX: "true" },
      { ...configuration, CUSTODY_LOCAL_AUTH_TOKEN: undefined }, { ...configuration, CUSTODY_LOCAL_AUTH_TOKEN: "short" },
      { ...configuration, CUSTODY_LOCAL_AUTH_TOKEN: "x".repeat(64) }, { ...configuration, CUSTODY_SELLER_ID: "" },
      { ...configuration, CUSTODY_SELLER_ID: " local-owner" },
    ]) assert.equal(localSandboxAuthorized(request(url, token), config), false);
  }
});

test("hosted and lookalike URLs never honor a local token, even with forged routing or identity headers", () => {
  for (const url of ["https://custody.example/api/state", "http://127.0.0.1.attacker.example/api/state", "http://localhost.attacker.example/api/state", "http://192.168.1.20:4381/api/state", "https://example.com/?host=localhost"]) {
    assert.equal(localSandboxConfigured(url, configuration), false);
    assert.equal(localSandboxAuthorized(request(url, token, { Host: "localhost", "X-Forwarded-Host": "127.0.0.1", "oai-authenticated-user-id": "local-owner", "oai-authenticated-user-email": "claimed@example.com" }), configuration), false);
  }
  assert.equal(localSandboxAuthorized(request("http://localhost:4381/api/state", undefined, { "oai-authenticated-user-id": "local-owner", "oai-authenticated-user-email": "claimed@example.com" }), configuration), false);
  assert.equal(isLoopbackURL("not a URL"), false);
  assert.equal(isLoopbackURL("file://localhost/path"), false);
});

test("fixed-work local token comparison checks both ends and exact length", () => {
  assert.equal(fixedWorkTokenEqual(token, token), true);
  assert.equal(fixedWorkTokenEqual(token, "b" + token.slice(1)), false);
  assert.equal(fixedWorkTokenEqual(token, token.slice(0, -1) + "b"), false);
  assert.equal(fixedWorkTokenEqual(token, token + "a"), false);
  assert.equal(fixedWorkTokenEqual("short", "short"), false);
});

test("judge setup preserves provider credentials and seller identity while replacing only local access keys", () => {
  const original = 'CUSTODY_SELLER_ID="existing-owner"\r\nPAYPAL_CLIENT_SECRET="software-test-placeholder"\r\nEXTRACTOR_KEY="different-software-test-placeholder"\r\nOTHER="keep this unchanged"\r\nCUSTODY_LOCAL_SANDBOX="old"\r\nCUSTODY_LOCAL_AUTH_TOKEN="old"\r\nCUSTODY_LOCAL_AUTH_TOKEN="duplicate"\r\n';
  const output = judgeEnvironmentContent(original, token);
  assert.ok(output.includes('CUSTODY_SELLER_ID="existing-owner"\r\n'));
  assert.ok(output.includes('PAYPAL_CLIENT_SECRET="software-test-placeholder"\r\n'));
  assert.ok(output.includes('EXTRACTOR_KEY="different-software-test-placeholder"\r\n'));
  assert.ok(output.includes('OTHER="keep this unchanged"\r\n'));
  assert.equal(output.match(/^CUSTODY_LOCAL_AUTH_TOKEN=/gm)?.length, 1);
  assert.ok(output.endsWith(`CUSTODY_LOCAL_SANDBOX="enabled"\r\nCUSTODY_LOCAL_AUTH_TOKEN="${token}"\r\n`));
  const fresh = judgeEnvironmentContent(undefined, token);
  assert.ok(fresh.includes('CUSTODY_SELLER_ID="local-owner"'));
  assert.ok(fresh.includes('PAYPAL_CLIENT_SECRET=""'));
  assert.ok(fresh.includes('EXTRACTOR_KEY=""'));
  assert.throws(() => judgeEnvironmentContent(original, "not-a-token"));
});

test("judge setup refuses directories and hard-linked env files before any credential write", () => {
  const root = mkdtempSync(path.join(tmpdir(), "custody-judge-setup-test-"));
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "custody" }));
    const target = path.join(root, ".dev.vars");
    mkdirSync(target);
    assert.throws(() => setupJudgeEnvironment(root), /non-regular/);
    rmdirSync(target);
    const linkedDirectory = path.join(root, "linked-directory");
    mkdirSync(linkedDirectory);
    symlinkSync(linkedDirectory, target, "junction");
    assert.throws(() => setupJudgeEnvironment(root), /symlink/);
    unlinkSync(target);
    const original = path.join(root, "original.env");
    writeFileSync(original, 'CUSTODY_SELLER_ID="do-not-change"\n');
    linkSync(original, target);
    assert.throws(() => setupJudgeEnvironment(root), /hard-linked/);
    assert.equal(readFileSync(original, "utf8"), 'CUSTODY_SELLER_ID="do-not-change"\n');
  } finally {
    // Only known test paths are removed; cleanup never traverses a link.
    for (const name of [".dev.vars", "original.env", "package.json", "linked-directory"]) {
      const target = path.join(root, name);
      if (existsSync(target)) {
        const stat = lstatSync(target);
        if (stat.isDirectory() && !stat.isSymbolicLink()) rmdirSync(target);
        else unlinkSync(target);
      }
    }
    rmdirSync(root);
  }
});

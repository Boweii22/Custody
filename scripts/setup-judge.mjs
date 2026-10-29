import { randomBytes } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(import.meta.dirname, '..');

/** Kept separate so preservation of existing credentials is testable without reading any real env file. */
export function judgeEnvironmentContent(existing, token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('A fresh 64-character local access token is required.');
  const fresh = existing === undefined;
  const original = fresh ? [
    '# Your own PayPal sandbox and model credentials. Never commit this file.',
    'CUSTODY_RAIL="sandbox"',
    'CUSTODY_SELLER_ID="local-owner"',
    'PAYPAL_CLIENT_ID=""',
    'PAYPAL_CLIENT_SECRET=""',
    'EXTRACTOR_URL="https://api.openai.com/v1/chat/completions"',
    'EXTRACTOR_KEY=""',
    'EXTRACTOR_MODEL="gpt-4.1-mini"',
    '',
  ].join('\n') : existing;
  if (typeof original !== 'string') throw new Error('The existing env file must be text.');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  // Replace only these two local-access settings, including prior duplicates.
  let result = original.replace(/^[ \t]*(?:export[ \t]+)?CUSTODY_LOCAL_(?:SANDBOX|AUTH_TOKEN)[ \t]*=[^\r\n]*(?:\r?\n|$)/gm, '');
  if (result && !result.endsWith('\n')) result += eol;
  return `${result}CUSTODY_LOCAL_SANDBOX="enabled"${eol}CUSTODY_LOCAL_AUTH_TOKEN="${token}"${eol}`;
}

function safeExistingTarget(target) {
  let stat;
  try { stat = lstatSync(target); }
  catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Refusing a symlink, hard-linked, or non-regular .dev.vars target.');
  // O_NOFOLLOW is supported on Unix; lstat plus atomic replacement also protects
  // Windows writes from following a target link into another directory.
  const descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { return readFileSync(descriptor, 'utf8'); }
  finally { closeSync(descriptor); }
}

export function setupJudgeEnvironment(workspace = defaultRoot) {
  const root = realpathSync(workspace);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'custody') throw new Error('Run judge setup from the Custody repository.');
  const target = path.join(root, '.dev.vars');
  const existing = safeExistingTarget(target);
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', '.dev.vars'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (tracked.error || tracked.status === null) throw new Error('Could not verify that the local env file is untracked; no file was written.');
  if (tracked.status === 0) throw new Error('Refusing to write a secret to a tracked .dev.vars file.');
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', '.dev.vars'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (ignored.error || ignored.status !== 0) throw new Error('The .dev.vars path must be ignored by Git before local access can be configured.');
  const output = judgeEnvironmentContent(existing, randomBytes(32).toString('hex'));
  const temporary = path.join(root, `.dev.vars.setup-${randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, output, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    // Recheck before replacing. rename does not follow the destination target.
    if (safeExistingTarget(target) !== existing) throw new Error('The env file changed during setup; no replacement was made. Retry after finishing your edits.');
    renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { targetPath: target, existingCredentialsPreserved: existing !== undefined, localSandboxEnabled: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--enable-local-sandbox') throw new Error('Explicit opt-in required: node scripts/setup-judge.mjs --enable-local-sandbox');
    const result = setupJudgeEnvironment();
    console.log(`Local sandbox access configured in ${result.targetPath}`);
    console.log(result.existingCredentialsPreserved ? 'Existing provider credentials and seller identity were preserved.' : 'Enter your own sandbox and model credentials in that ignored file.');
    console.log('Copy CUSTODY_LOCAL_AUTH_TOKEN from that file into the local Custody unlock field. The token is never printed or placed in a URL.');
    console.log('Use npm run dev -- --hostname 127.0.0.1 --port 4381. Keep the server bound to loopback.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Local sandbox setup failed without exposing credentials.');
    process.exitCode = 1;
  }
}

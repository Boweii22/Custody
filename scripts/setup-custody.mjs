import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run setup.');

function run(args) {
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const requiredPackages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
const dependenciesReady = existsSync('node_modules/.package-lock.json') &&
  requiredPackages.every((name) => existsSync(path.join(root, 'node_modules', name, 'package.json')));
if (!dependenciesReady) run([npmCli, 'run', 'install:ci']);
// Existing metadata does not imply that it matches the current schema. Drizzle
// emits no migration when there is no delta, so this is safe on every setup run.
run([npmCli, 'run', 'db:generate']);
run([npmCli, 'run', 'build']);

const built = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
const database = built.d1_databases?.find((binding) => binding.binding === 'DB');
if (!database?.database_id || !database.database_name) {
  throw new Error('The built Worker is missing its DB binding. Check .openai/hosting.json.');
}

// The build output is in dist/server and does not carry a migrations_dir.
// Give Wrangler an explicit absolute path while retaining the exact database
// identity used by dev/start. This generated local config is ignored by Git.
const localConfig = path.join(root, '.wrangler', 'custody-migrations.json');
mkdirSync(path.dirname(localConfig), { recursive: true });
writeFileSync(localConfig, JSON.stringify({
  name: 'custody-local-migrations',
  compatibility_date: built.compatibility_date ?? '2026-05-15',
  d1_databases: [{ ...database, migrations_dir: path.join(root, 'drizzle') }],
}, null, 2) + '\n');

// Wrangler records completed filenames in D1 and applies only pending files.
run([
  '--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js',
  'd1', 'migrations', 'apply', 'DB', '--local', '--config', localConfig,
  '--persist-to', path.join(root, '.wrangler', 'state'),
]);
console.log('\nCustody is ready. Run npm run dev -- --hostname 127.0.0.1 --port 3000');

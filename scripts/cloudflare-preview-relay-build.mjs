import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';

const SUPABASE_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const SLOT = '4qw7puafIwEe_LXAO05q_rfEYCxyv8ccyp4L_uC-NIs';
const TABLE = 'cloudflare_preview_relay_176';
const PREVIEW_ALIAS = 'pv-pr176';
const REAL_WRANGLER_ROOT = '.cloudflare-real-wrangler';
const PREVIEW_CONFIG = '.cloudflare-preview-runtime.jsonc';

if (process.env.WORKERS_CI !== '1' || !process.env.WORKERS_CI_BRANCH || process.env.WORKERS_CI_BRANCH === 'main') process.exit(0);

const commitSha = String(process.env.WORKERS_CI_COMMIT_SHA || '').toLowerCase();
if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('cloudflare_preview_relay_invalid_sha');

const install = spawnSync('npm', [
  'install',
  '--prefix', REAL_WRANGLER_ROOT,
  '--no-save',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  'wrangler@4.127.1',
], { stdio: 'inherit', env: process.env });
if (install.status !== 0) throw new Error(`cloudflare_preview_relay_wrangler_install_failed_${install.status ?? 'unknown'}`);

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
delete config.build;
config.name = 'studia-voice';
config.workers_dev = true;
config.preview_urls = true;
config.vars = { ...(config.vars || {}), PV_COMMIT: commitSha };
await writeFile(PREVIEW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

await mkdir('node_modules/wrangler/bin', { recursive: true });
await mkdir('node_modules/.bin', { recursive: true });
await writeFile('node_modules/wrangler/package.json', JSON.stringify({
  name: 'wrangler',
  version: '4.127.1-pablovoice-preview-shim',
  type: 'module',
  bin: { wrangler: 'bin/wrangler.mjs' },
}, null, 2));

const wrapper = `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(SUPABASE_PUBLISHABLE_KEY)};
const SLOT = ${JSON.stringify(SLOT)};
const TABLE = ${JSON.stringify(TABLE)};
const PREVIEW_ALIAS = ${JSON.stringify(PREVIEW_ALIAS)};
const PREVIEW_CONFIG = ${JSON.stringify(PREVIEW_CONFIG)};
const commitSha = String(process.env.WORKERS_CI_COMMIT_SHA || '').toLowerCase();
const root = process.cwd();
const realPackagePath = resolve(root, ${JSON.stringify(REAL_WRANGLER_ROOT)}, 'node_modules/wrangler/package.json');
const realPackage = JSON.parse(readFileSync(realPackagePath, 'utf8'));
const realBinRel = typeof realPackage.bin === 'string' ? realPackage.bin : realPackage.bin?.wrangler;
if (!realBinRel) throw new Error('cloudflare_preview_relay_real_wrangler_bin_missing');
const realBin = resolve(root, ${JSON.stringify(REAL_WRANGLER_ROOT)}, 'node_modules/wrangler', realBinRel);
const incoming = process.argv.slice(2);
let args = incoming;
if (incoming[0] === 'deploy') {
  const rest = [];
  for (let i = 1; i < incoming.length; i += 1) {
    if (incoming[i] === '--config' || incoming[i] === '-c') { i += 1; continue; }
    rest.push(incoming[i]);
  }
  args = ['versions', 'upload', ...rest, '--config', PREVIEW_CONFIG, '--preview-alias', PREVIEW_ALIAS];
}
const result = spawnSync(process.execPath, [realBin, ...args], {
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 16 * 1024 * 1024,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
if (incoming[0] !== 'deploy') process.exit(0);
const output = String(result.stdout || '') + '\\n' + String(result.stderr || '');
const previewUrl = output.match(/https:\\/\\/[a-z0-9.-]+\\.workers\\.dev\\/?/i)?.[0]?.replace(/\\/$/, '') || '';
if (!previewUrl) {
  console.error('CLOUDFLARE_PREVIEW_RELAY_FAILED: preview URL missing from native versions upload');
  process.exit(86);
}
const relay = await fetch(SUPABASE_URL + '/rest/v1/' + TABLE, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
    'content-type': 'application/json',
    prefer: 'return=minimal',
  },
  body: JSON.stringify({ slot: SLOT, sha: commitSha, url: previewUrl }),
});
if (!relay.ok) {
  console.error('CLOUDFLARE_PREVIEW_RELAY_FAILED: Supabase HTTP ' + relay.status);
  process.exit(87);
}
console.log(JSON.stringify({ scope: 'cloudflare_preview_relay', preview_created: true, relay_written: true, commit: commitSha }));
`;
await writeFile('node_modules/wrangler/bin/wrangler.mjs', wrapper, 'utf8');
await chmod('node_modules/wrangler/bin/wrangler.mjs', 0o755);
await writeFile('node_modules/.bin/wrangler', '#!/bin/sh\nexec node "$(dirname "$0")/../wrangler/bin/wrangler.mjs" "$@"\n', 'utf8');
await chmod('node_modules/.bin/wrangler', 0o755);

console.log(JSON.stringify({ scope: 'cloudflare_preview_relay_prepare', shim_ready: true, commit: commitSha }));

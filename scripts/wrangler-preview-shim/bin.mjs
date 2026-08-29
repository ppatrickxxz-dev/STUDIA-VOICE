#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const REAL_WRANGLER = resolve(ROOT, 'node_modules/wrangler-real/bin/wrangler.js');
const SOURCE_CONFIG = resolve(ROOT, 'wrangler.jsonc');
const PREVIEW_CONFIG = resolve(ROOT, '.cloudflare-preview-runtime.jsonc');
const SUPABASE_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const TABLE = 'cloudflare_preview_relay_176';
const SLOT = '4qw7puafIwEe_LXAO05q_rfEYCxyv8ccyp4L_uC-NIs';
const PREVIEW_ALIAS = 'pv-pr176';

const incoming = process.argv.slice(2);
const isNativeBranchDeploy = process.env.WORKERS_CI === '1' && process.env.WORKERS_CI_BRANCH && process.env.WORKERS_CI_BRANCH !== 'main' && incoming[0] === 'deploy';

let args = incoming;
if (isNativeBranchDeploy) {
  const commitSha = String(process.env.WORKERS_CI_COMMIT_SHA || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    console.error('CLOUDFLARE_PREVIEW_SHIM_FAILED: invalid WORKERS_CI_COMMIT_SHA');
    process.exit(81);
  }
  const config = JSON.parse(readFileSync(SOURCE_CONFIG, 'utf8'));
  delete config.build;
  config.name = 'studia-voice';
  config.workers_dev = true;
  config.preview_urls = true;
  config.vars = { ...(config.vars || {}), PV_COMMIT: commitSha };
  writeFileSync(PREVIEW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const passthrough = [];
  for (let index = 1; index < incoming.length; index += 1) {
    if (incoming[index] === '--config' || incoming[index] === '-c') {
      index += 1;
      continue;
    }
    passthrough.push(incoming[index]);
  }
  args = ['versions', 'upload', ...passthrough, '--config', PREVIEW_CONFIG, '--preview-alias', PREVIEW_ALIAS];
}

const result = spawnSync(process.execPath, [REAL_WRANGLER, ...args], {
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 16 * 1024 * 1024,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (isNativeBranchDeploy) {
  try { unlinkSync(PREVIEW_CONFIG); } catch {}
}
if (result.error) {
  console.error(`CLOUDFLARE_PREVIEW_SHIM_FAILED: ${String(result.error.message || result.error)}`);
  process.exit(82);
}
if (result.status !== 0) process.exit(result.status ?? 83);
if (!isNativeBranchDeploy) process.exit(0);

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const previewUrl = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\/?/i)?.[0]?.replace(/\/$/, '') || '';
if (!previewUrl) {
  console.error('CLOUDFLARE_PREVIEW_SHIM_FAILED: native versions upload returned no workers.dev URL');
  process.exit(84);
}

const commitSha = String(process.env.WORKERS_CI_COMMIT_SHA || '').toLowerCase();
const relay = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'content-type': 'application/json',
    prefer: 'return=minimal',
  },
  body: JSON.stringify({ slot: SLOT, sha: commitSha, url: previewUrl }),
}).catch(() => null);
if (!relay?.ok) {
  console.error(`CLOUDFLARE_PREVIEW_SHIM_FAILED: relay HTTP ${relay?.status || 0}`);
  process.exit(85);
}
console.log(JSON.stringify({ scope: 'cloudflare_preview_shim', preview_created: true, relay_written: true, commit: commitSha }));

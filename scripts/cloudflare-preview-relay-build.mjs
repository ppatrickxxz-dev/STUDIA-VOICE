import { spawnSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';

const SUPABASE_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const SLOT = '4qw7puafIwEe_LXAO05q_rfEYCxyv8ccyp4L_uC-NIs';
const TABLE = 'cloudflare_preview_relay_176';
const PREVIEW_ALIAS = 'pv-pr176';

if (process.env.WORKERS_CI !== '1' || !process.env.WORKERS_CI_BRANCH || process.env.WORKERS_CI_BRANCH === 'main') process.exit(0);

const commitSha = String(process.env.WORKERS_CI_COMMIT_SHA || '').toLowerCase();
if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('cloudflare_preview_relay_invalid_sha');

const configPath = '.cloudflare-preview-relay-wrangler.jsonc';
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
delete config.build;
config.name = 'studia-voice';
config.workers_dev = true;
config.preview_urls = true;
config.vars = { ...(config.vars || {}), PV_COMMIT: commitSha };
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

let previewUrl = '';
try {
  const result = spawnSync('npx', ['--yes', 'wrangler@4.127.1', 'versions', 'upload', '--config', configPath, '--preview-alias', PREVIEW_ALIAS], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(`cloudflare_preview_upload_failed_${result.status ?? 'unknown'}`);
  previewUrl = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\/?/i)?.[0]?.replace(/\/$/, '') || '';
  if (!previewUrl) throw new Error('cloudflare_preview_url_missing');

  const relay = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ slot: SLOT, sha: commitSha, url: previewUrl }),
  });
  if (!relay.ok) throw new Error(`cloudflare_preview_relay_failed_${relay.status}`);
  console.log(JSON.stringify({ scope: 'cloudflare_preview_relay', preview_created: true, relay_written: true, commit: commitSha }));
} finally {
  await unlink(configPath).catch(() => {});
}

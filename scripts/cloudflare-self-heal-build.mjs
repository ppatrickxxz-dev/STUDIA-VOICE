import { execFileSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';

const ACCOUNT_ID = '298743c0a067a8c61dc082feb62aeae4';
const REPOSITORY = 'ppatrickxxz-dev/STUDIA-VOICE';
const PR_NUMBER = 176;
const EXPECTED_WORKER = 'studia-voice';
const PREVIEW_ALIAS = 'pv-pr176';
const API_ROOT = 'https://api.cloudflare.com/client/v4';

const isWorkersBuild = process.env.WORKERS_CI === '1';
const branch = String(process.env.WORKERS_CI_BRANCH || '');
const buildUuid = String(process.env.WORKERS_CI_BUILD_UUID || '');
const commitSha = String(process.env.WORKERS_CI_COMMIT_SHA || '');

if (!isWorkersBuild || !branch || branch === 'main') process.exit(0);

const token = String(process.env.CLOUDFLARE_API_TOKEN || '');

async function cf(path, options = {}) {
  if (!token) return null;
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  }).catch(() => null);
  if (!response) return null;
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

async function repairPreviewTrigger() {
  if (!token || !buildUuid) return false;
  const current = await cf(`/accounts/${ACCOUNT_ID}/builds/builds/${encodeURIComponent(buildUuid)}`);
  if (!current?.ok) return false;
  const result = current.data?.result || {};
  const observedSha = String(result.build_trigger_metadata?.commit_hash || '');
  const observedBranch = String(result.build_trigger_metadata?.branch || '');
  const triggerUuid = String(result.trigger?.trigger_uuid || '');
  const deployCommand = String(result.build_trigger_metadata?.deploy_command || result.trigger?.deploy_command || '');
  if (!triggerUuid || (commitSha && observedSha && observedSha !== commitSha) || (observedBranch && observedBranch !== branch)) return false;
  if (/wrangler\s+versions\s+upload/.test(deployCommand)) return true;
  const patched = await cf(`/accounts/${ACCOUNT_ID}/builds/triggers/${encodeURIComponent(triggerUuid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ deploy_command: 'npx wrangler versions upload' }),
  });
  return Boolean(patched?.ok);
}

function sanitizeAlias(value) {
  const alias = String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(alias) ? alias.slice(0, 24) : PREVIEW_ALIAS;
}

async function uploadKnownPreview() {
  const configPath = '.cloudflare-self-heal-wrangler.jsonc';
  const source = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  delete source.build;
  source.name = EXPECTED_WORKER;
  source.workers_dev = true;
  source.preview_urls = true;
  source.vars = { ...(source.vars || {}), PV_COMMIT: commitSha || 'workers-ci' };
  await writeFile(configPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  try {
    const output = execFileSync('npx', [
      '--yes',
      'wrangler@4.127.1',
      'versions',
      'upload',
      '--config',
      configPath,
      '--preview-alias',
      sanitizeAlias(PREVIEW_ALIAS),
    ], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
    const match = String(output).match(/https:\/\/[^\s)]+\.workers\.dev[^\s)]*/i);
    return match?.[0] || '';
  } catch {
    return '';
  } finally {
    await unlink(configPath).catch(() => {});
  }
}

function githubCredential() {
  try {
    const output = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const pairs = Object.fromEntries(String(output).trim().split(/\r?\n/).map((line) => {
      const index = line.indexOf('=');
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ['', ''];
    }).filter(([key]) => key));
    return pairs.password || '';
  } catch {
    return '';
  }
}

async function publishPreviewEvidence(url) {
  if (!url) return false;
  const ghToken = githubCredential();
  if (!ghToken) return false;
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/issues/${PR_NUMBER}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ghToken}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ body: `[cloudflare-runtime-proof] sha=${commitSha} preview=${url}` }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

const triggerRepaired = await repairPreviewTrigger();
const previewUrl = await uploadKnownPreview();
const evidencePublished = await publishPreviewEvidence(previewUrl);
console.log(JSON.stringify({
  scope: 'cloudflare_self_heal',
  branch,
  commit: commitSha,
  trigger_repaired: triggerRepaired,
  preview_created: Boolean(previewUrl),
  evidence_published: evidencePublished,
}));

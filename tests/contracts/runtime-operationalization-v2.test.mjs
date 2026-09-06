import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FROZEN_PROVIDER_SHA = '85b6341bac253f85a48506400baed3dd2bbf212ac172af6d0fa8e47d35642b95';
const CANONICAL_SOURCE_SHA = '852890854c128a4ee222505a910c3dc01465579d34ed6b49b5019aec8f16ad83';
const INVALID_REFREEZE_SHA = '5d02cef6ddb423f95485f2f202dba0c1634ab7a001307743f631f5078a2f1439';
const FROZEN_PROVIDER_SIZE = 15_335_120;

const releaseFreezeFiles = [
  '.github/workflows/materialize-frozen-release-evidence.yml',
  'benchmarks/assets/binary-reference-manifest.json',
  'benchmarks/assets/voice-identity-preservation.json',
  'benchmarks/results/acoustic-benchmark-matrix-v1.json',
  'benchmarks/results/pablovoice-runtime-readiness-v1.json',
  'benchmarks/validate_b04.py',
  'docs/B09_STANDALONE_LIVE_EVIDENCE_2026-08-29.json',
  'docs/release-evidence-ingest-v1.md',
  'packages/providers/src/b04-voice-identity-contract.mjs',
  'supabase/functions/diagnose-once-v56/index.ts',
  'tests/contracts/release-evidence-ingest.test.mjs',
];

const recoveredRuntimeDirs = [
  'supabase/functions/recording-ticket-v63',
  'supabase/functions/recording-finalize-v63',
  'supabase/functions/studio-state-v61',
  'supabase/functions/studio-history-v64',
  'supabase/functions/track-effects-v66',
  'supabase/functions/audio-analysis-v67',
  'supabase/functions/voice-lab-v68',
  'supabase/functions/device-auth',
];

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

test('release vocal input is immutable and the rejected re-freeze cannot return', () => {
  for (const path of releaseFreezeFiles) {
    const source = read(path);
    assert.equal(source.includes(INVALID_REFREEZE_SHA), false, `${path} still contains rejected re-freeze SHA`);
    assert.equal(source.includes(FROZEN_PROVIDER_SHA), true, `${path} lost frozen provider SHA`);
  }
  const manifest = JSON.parse(read('benchmarks/assets/binary-reference-manifest.json'));
  const providerInput = manifest?.assets?.vocal_provider_input;
  assert.ok(providerInput, 'binary manifest lost assets.vocal_provider_input');
  assert.equal(providerInput.sha256, FROZEN_PROVIDER_SHA);
  assert.equal(providerInput.derived_from_sha256, CANONICAL_SOURCE_SHA);
  assert.equal(Number(providerInput.size_bytes), FROZEN_PROVIDER_SIZE);
});

test('current user-facing Edge Function sources are reconstructible from Git', () => {
  for (const dir of recoveredRuntimeDirs) {
    assert.equal(existsSync(join(ROOT, dir, 'index.ts')), true, `${dir}/index.ts is missing`);
  }
});

test('device auth is Cloudflare-direct and has no Vercel or preview-slot dependency', () => {
  const source = read('supabase/functions/device-auth/index.ts');
  assert.match(source, /https:\/\/studia-voice\.ppatrickxxz\.workers\.dev/);
  assert.equal(source.includes('vercel.app'), false);
  assert.equal(source.includes('app-v60-preview'), false);
  assert.equal(source.includes('pablovoice-mobile-gate'), false);
  assert.match(source, /preview_slot_dependency:false/);
  const client = read('packages/app/remote-auth.mjs');
  assert.match(client, /consumeBootstrapFragment/);
  assert.match(client, /studia-voice\.ppatrickxxz\.workers\.dev/);
});

test('versioned Edge Function source never self-imports PabloVoice runtime from raw GitHub', () => {
  const root = join(ROOT, 'supabase/functions');
  for (const file of walk(root).filter(path => /\.(?:ts|js|mjs)$/.test(path))) {
    const source = readFileSync(file, 'utf8');
    assert.equal(source.includes('raw.githubusercontent.com/ppatrickxxz-dev/STUDIA-VOICE'), false, `${file} uses remote self-import`);
  }
});

test('new shortcut-style Edge Function slugs are forbidden outside explicit migration debt', () => {
  const transitional = new Set(['diagnose-once-v56', 'test-voice-v71-identity-once', 'validate-app-js-v71']);
  const slugs = readdirSync(join(ROOT, 'supabase/functions'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  for (const slug of slugs) {
    const shortcut = /^app-v\d+$/.test(slug) || /^repair-/.test(slug) || /-once(?:-|$)/.test(slug) || /-preview(?:-|$)/.test(slug);
    if (shortcut) assert.equal(transitional.has(slug), true, `new shortcut Edge Function slug is forbidden: ${slug}`);
  }
});

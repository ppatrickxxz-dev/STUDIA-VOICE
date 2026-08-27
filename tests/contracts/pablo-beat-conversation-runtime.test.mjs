import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Pablo conversation routes explicit beat commands before creative PMI', async () => {
  const conversation = await read('packages/app/pablo-conversation-audio.mjs');
  assert.match(conversation, /kind === 'beat_operation'/);
  assert.match(conversation, /executeDefaultBeatOperation/);
  assert.match(conversation, /pablo-beat-runtime\.mjs/);
  assert.match(conversation, /const music = await tryMusicIntelligence/);
  assert.match(conversation, /domain: 'beat_lab'/);
  assert.match(conversation, /originalKind: direct\.kind/);
  assert.match(conversation, /kind: 'deterministic_edit'/);
  assert.ok(conversation.indexOf("kind === 'beat_operation'") < conversation.indexOf('const music = await tryMusicIntelligence'));
});

test('canonical beat runtime persists only successful mutations and never falls into another project', async () => {
  const runtime = await read('packages/app/pablo-beat-runtime.mjs');
  const operations = await read('packages/app/pablo-beat-operations.mjs');
  assert.match(runtime, /applyPabloBeatOperation/);
  assert.match(runtime, /await applyPabloBeatOperation/);
  assert.match(runtime, /saveProject\(result\.project\)/);
  assert.match(runtime, /!result\?\.ok \|\| !result\?\.mutated/);
  assert.match(runtime, /projectId && !project/);
  assert.match(runtime, /reason: 'project_not_found'/);
  assert.match(runtime, /Não mexi em outro projeto como fallback/);
  assert.ok(runtime.indexOf('projectId && !project') < runtime.indexOf('listProjects())[0]'));
  assert.match(operations, /section_mapping_required/);
  assert.match(operations, /genre_pattern_preview_only/);
  assert.match(operations, /groove_evidence_unavailable/);
  assert.match(operations, /snapshotProjectCompat/);
});

test('beat commands do not depend on random generation or remote providers', async () => {
  const [conversation, operations, runtime] = await Promise.all([
    read('packages/app/pablo-conversation-audio.mjs'),
    read('packages/app/pablo-beat-operations.mjs'),
    read('packages/app/pablo-beat-runtime.mjs'),
  ]);
  const beatCode = `${operations}\n${runtime}`;
  assert.doesNotMatch(beatCode, /Math\.random/);
  assert.doesNotMatch(beatCode, /agentTurn|RemoteAuthAdapter|fetch\(/);
  assert.match(conversation, /beat_generation_plan/);
});

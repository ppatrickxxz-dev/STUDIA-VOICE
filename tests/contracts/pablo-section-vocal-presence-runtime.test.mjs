import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('presence adapter boots in canonical Pablo shell and verifies persisted peaking metadata', async () => {
  const [preboot, adapter] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/pablo-section-vocal-presence-adapter.mjs'),
  ]);
  assert.match(preboot, /pablo-section-vocal-presence-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalPresenceAdapter/);
  assert.match(adapter, /saveProject\(snapshotted\)/);
  assert.match(adapter, /await getProject\(project\.id\)/);
  assert.match(adapter, /savedEvent\.kind !== 'peaking_eq'/);
  assert.match(adapter, /savedEvent\.frequencyHz/);
  assert.match(adapter, /savedEvent\.q/);
});

test('presence reuses the already validated regional peaking EQ processed and offline path', async () => {
  const [engine, regionalEq, core] = await Promise.all([
    read('packages/app/audio-engine.mjs'),
    read('packages/audio/src/automation/region-eq.mjs'),
    read('packages/core/src/section-vocal-presence.mjs'),
  ]);
  assert.match(core, /kind: 'peaking_eq'/);
  assert.match(core, /DEFAULT_PRESENCE_FREQUENCY_HZ = 3200/);
  assert.match(core, /DEFAULT_PRESENCE_Q = 0\.9/);
  assert.match(engine, /regionalPeakingEqEvents/);
  assert.match(engine, /peakingEqAutomationPoints/);
  assert.match(engine, /connectRegionalEq/);
  assert.match(engine, /createTrackSources\(offline/);
  assert.match(regionalEq, /REGIONAL_PEAKING_EQ_KIND = 'peaking_eq'/);
});

test('A B and selective undo own presence only through the canonical Pablo source', async () => {
  const [ab, undo] = await Promise.all([
    read('packages/core/src/section-mix-ab.mjs'),
    read('packages/core/src/section-mix-undo.mjs'),
  ]);
  assert.match(ab, /PABLO_SECTION_VOCAL_PRESENCE_SOURCE/);
  assert.match(undo, /VOCAL_PRESENCE: 'vocal_presence'/);
  assert.match(undo, /PABLO_SECTION_VOCAL_PRESENCE_SOURCE/);
  assert.doesNotMatch(undo, /regionAutomation\s*=\s*\[\]/);
  assert.doesNotMatch(undo, /user_manual.*sourcesForMode|pablo_breath_intelligence.*sourcesForMode/);
});

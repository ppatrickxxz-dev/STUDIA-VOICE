import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Pablo chat exposes reviewed Wave section generation without provider branding in primary copy', async () => {
  const [ui, execution] = await Promise.all([
    read('packages/app/pablo-musical-plan-ui.mjs'),
    read('packages/app/pablo-musical-generation-execution.mjs'),
  ]);

  assert.match(ui, /Wave · edição por seção/);
  assert.match(ui, /Gerar nova versão/);
  assert.match(ui, /restante e a versão anterior ficam preservados/);
  assert.match(ui, /executeReviewedSectionRegeneration/);
  assert.match(execution, /preserveUnselected:\s*true/);
  assert.match(execution, /section_ambiguous/);
  assert.match(execution, /recent_studio_playhead/);
  assert.doesNotMatch(ui, /ElevenLabs|Music v2|\bHQ\b/);
});

test('review fingerprint binds section generation to take and continuity identity', async () => {
  const review = await read('packages/app/pablo-musical-plan-review.mjs');
  assert.match(review, /providerSongId/);
  assert.match(review, /latestTakeId/);
  assert.match(review, /referenceTrackId/);
  assert.match(review, /derivedFromTakeId/);
  assert.match(review, /musical_state_drift/);
});

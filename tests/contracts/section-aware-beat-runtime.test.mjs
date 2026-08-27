import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('project schema owns the canonical arrangement map and snapshots it', async () => {
  const project = await read('packages/core/src/project.mjs');
  assert.match(project, /PROJECT_SCHEMA_VERSION = 6/);
  assert.match(project, /createArrangementMap/);
  assert.match(project, /normalizeArrangementMap/);
  assert.match(project, /arrangementMap: structuredClone\(clean\.arrangementMap\)/);
  assert.match(project, /beatLab: clean\.beatLab \? structuredClone\(clean\.beatLab\) : null/);
});

test('section execution requires confirmed timing and never derives timeline from lyrics', async () => {
  const [sections, operations, conversation] = await Promise.all([
    read('packages/core/src/section-map.mjs'),
    read('packages/app/pablo-beat-operations.mjs'),
    read('packages/app/pablo-conversation-audio.mjs'),
  ]);

  assert.match(sections, /timingStatus === 'confirmed'/);
  assert.match(sections, /section\.confidence >= 0\.8/);
  assert.match(operations, /findConfirmedSection/);
  assert.match(operations, /section_mapping_required/);
  assert.match(operations, /section_fill_runtime_required/);
  assert.doesNotMatch(operations, /analyzeLyrics|classifyStructure/);
  assert.doesNotMatch(sections, /analyzeLyrics|classifyStructure/);
  assert.match(conversation, /parseSectionMarker/);
  assert.match(conversation, /beatOperation\('mark_section'/);
});

test('section markers are resolved before generic creative or deterministic routing', async () => {
  const conversation = await read('packages/app/pablo-conversation-audio.mjs');
  const marker = conversation.indexOf('const sectionMarker = parseSectionMarker(text)');
  const music = conversation.indexOf('const music = await tryMusicIntelligence');
  const genericEdit = conversation.indexOf('looksLikeDeterministicEdit(text)');
  assert.ok(marker >= 0);
  assert.ok(genericEdit > marker);
  assert.ok(music > marker);
});

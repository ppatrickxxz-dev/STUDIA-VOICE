import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, snapshotProject } from '../../packages/core/src/project.mjs';
import { interpretMusicalIntent } from '../../packages/music-intelligence/src/musical-intent.mjs';
import { routeMusicalIntent } from '../../packages/music-intelligence/src/operation-router.mjs';
import { compileMusicalOperation } from '../../packages/app/musical-operation-compiler.mjs';
import { applyPabloInstrumentOperation } from '../../packages/app/pablo-instrument-operations.mjs';

function route(message, context = {}) {
  return routeMusicalIntent(interpretMusicalIntent(message, context), context);
}

function instrumentProject(preset = 'bass') {
  const project = createProject('PMI Instrument Test', 1000);
  project.instrumentLab = {
    version: '2.0-local',
    preset,
    bpm: 96,
    notes: [
      { midi: 36, velocity: 96, start_beat: 0, duration_beats: 0.75 },
      { midi: 36, velocity: 92, start_beat: 1, duration_beats: 0.75 },
      { midi: 43, velocity: 94, start_beat: 2, duration_beats: 0.75 },
      { midi: 41, velocity: 90, start_beat: 3, duration_beats: 0.75 },
    ],
  };
  return project;
}

test('compiler chooses reversible local MIDI reshape for a matching bass pattern', () => {
  const project = instrumentProject('bass');
  const compiled = compileMusicalOperation(route('Esse baixo está muito quadrado, deixa mais vivo'), project);

  assert.equal(compiled.ok, true);
  assert.equal(compiled.executor, 'instrument_lab');
  assert.equal(compiled.action, 'reshape_groove');
  assert.equal(compiled.args.target, 'bass');
  assert.equal(compiled.args.sourcePreset, 'bass');
  assert.ok(compiled.args.humanize > 0);
  assert.ok(compiled.args.syncopation > 0);
  assert.equal(compiled.args.preservePitch, true);
  assert.equal(compiled.args.preserveNoteCount, true);
  assert.equal(compiled.constraints.canApply, false);
  assert.equal(compiled.constraints.nonDestructive, true);
});

test('compiler fails closed when conversational target does not match current Instrument Lab preset', () => {
  const compiled = compileMusicalOperation(route('Esse baixo está quadrado, deixa mais vivo'), instrumentProject('soft_pad'));
  assert.equal(compiled.ok, false);
  assert.equal(compiled.reason, 'instrument_target_mismatch');
  assert.equal(compiled.expectedPreset, 'bass');
  assert.equal(compiled.actualPreset, 'soft_pad');
  assert.deepEqual(compiled.fallback, ['music_generation']);
});

test('section-scoped instrument request does not pretend local section MIDI mapping exists', () => {
  const compiled = compileMusicalOperation(route('Esse baixo do refrão está muito quadrado'), instrumentProject('bass'));
  assert.equal(compiled.ok, false);
  assert.equal(compiled.reason, 'instrument_section_mapping_unavailable');
  assert.deepEqual(compiled.fallback, ['music_generation']);
});

test('Beat Lab compiler uses deterministic humanization first and reports unhandled musical deltas', () => {
  const project = createProject('Beat Test', 1000);
  project.beatLab = { version: 1, lanes: [] };
  const compiled = compileMusicalOperation(route('Deixa essa bateria mais sensual e menos reta'), project);

  assert.equal(compiled.ok, true);
  assert.equal(compiled.executor, 'beat_lab');
  assert.equal(compiled.action, 'humanize');
  assert.ok(compiled.args.amount > 0);
  assert.equal(compiled.partial, true);
  assert.ok(compiled.unhandledDeltas.includes('warmth'));
  assert.ok(compiled.unhandledDeltas.includes('density'));
  assert.deepEqual(compiled.fallback, ['music_generation']);
});

test('chorus direction compiles to the existing selective regeneration contract', () => {
  const project = createProject('Section Test', 1000);
  const compiled = compileMusicalOperation(route('Abre o refrão, mas sem ficar barulhento; mantém o resto'), project);

  assert.equal(compiled.ok, true);
  assert.equal(compiled.executor, 'music_generation');
  assert.equal(compiled.action, 'regenerate_section');
  assert.equal(compiled.args.section, 'chorus');
  assert.equal(compiled.args.preserveUnselected, true);
  assert.match(compiled.args.direction, /energy \+0\.20/);
  assert.ok(compiled.args.negativeStyles.includes('overcrowded arrangement'));
});

test('subjective mix direction remains blocked until a safe DSP mapping exists', () => {
  const compiled = compileMusicalOperation(route('Deixa o mix mais sensual'), createProject('Mix Test', 1000));
  assert.equal(compiled.ok, false);
  assert.equal(compiled.executor, 'audio_dsp');
  assert.equal(compiled.reason, 'specific_dsp_mapping_required');
});

test('project snapshots retain Instrument Lab state for later undo/review', () => {
  const project = instrumentProject('bass');
  const saved = snapshotProject(project, 'Instrument baseline');
  assert.deepEqual(saved.revisions.at(-1).instrumentLab, project.instrumentLab);
});

test('deterministic Instrument Lab execution reshapes groove without changing pitch or note count and captures baseline', async () => {
  const project = instrumentProject('bass');
  const before = structuredClone(project.instrumentLab);
  const compiled = compileMusicalOperation(route('Esse baixo está muito quadrado, deixa mais vivo'), project);
  const result = await applyPabloInstrumentOperation(project, compiled);

  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  assert.equal(result.invariants.pitchSequencePreserved, true);
  assert.equal(result.invariants.noteCountPreserved, true);
  assert.equal(result.invariants.presetPreserved, true);
  assert.equal(result.invariants.bpmPreserved, true);
  assert.equal(result.invariants.baselineRevisionCaptured, true);
  assert.equal(result.invariants.reversible, true);

  assert.deepEqual(result.after.midi, result.before.midi);
  assert.equal(result.after.noteCount, result.before.noteCount);
  assert.notDeepEqual(result.after.starts, result.before.starts);
  assert.notDeepEqual(result.after.velocities, result.before.velocities);
  assert.equal(result.project.instrumentLab.preset, before.preset);
  assert.equal(result.project.instrumentLab.bpm, before.bpm);
  assert.deepEqual(result.project.revisions.at(-2).instrumentLab, before);
  assert.deepEqual(result.project.revisions.at(-1).instrumentLab, result.project.instrumentLab);
});

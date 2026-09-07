import { normalizeInstrumentState } from './instrument-engine.mjs';
import { MUSICAL_EXECUTION_PLAN_SCHEMA } from './musical-operation-compiler.mjs';

export async function applyPabloInstrumentOperation(project, plan = {}) {
  if (!project || typeof project !== 'object') return blocked('project_required');
  if (!plan || plan.schema !== MUSICAL_EXECUTION_PLAN_SCHEMA || plan.ok !== true) return blocked('valid_execution_plan_required');
  if (plan.executor !== 'instrument_lab') return blocked('instrument_executor_required');
  if (plan.action !== 'reshape_groove') return blocked('unsupported_instrument_operation');
  if (plan.constraints?.reviewRequired !== true || plan.constraints?.nonDestructive !== true) {
    return blocked('unsafe_execution_contract');
  }

  const core = await loadProjectRuntime();
  if (!core) return blocked('project_runtime_unavailable');

  const current = normalizeInstrumentState(project.instrumentLab || {});
  if (!current.notes.length) return blocked('instrument_notes_required');
  const expectedPreset = String(plan.args?.sourcePreset || '');
  if (expectedPreset && current.preset !== expectedPreset) return blocked('instrument_state_drift');

  const humanize = clamp(Number(plan.args?.humanize) || 0, 0, 1);
  const syncopation = clamp(Number(plan.args?.syncopation) || 0, 0, 1);
  const durationVariation = clamp(Number(plan.args?.durationVariation) || 0, 0, 1);
  if (humanize === 0 && syncopation === 0 && durationVariation === 0) return blocked('no_effective_instrument_delta');

  const transformedNotes = reshapeNotes(current.notes, { humanize, syncopation, durationVariation });
  assertPitchAndCountPreserved(current.notes, transformedNotes);
  if (JSON.stringify(current.notes) === JSON.stringify(transformedNotes)) return blocked('no_effective_instrument_change');

  // Capture the current Instrument Lab as an explicit baseline because manual
  // "Salvar ideia" persistence historically did not create a project revision.
  const baseline = core.snapshotProject(core.migrateProject(project), 'Antes do ajuste inteligente de instrumento');
  const next = core.migrateProject(baseline);
  next.instrumentLab = normalizeInstrumentState({
    ...current,
    notes: transformedNotes,
  });
  const saved = core.snapshotProject(next, 'Instrumento ajustado pelo Pablo');

  return Object.freeze({
    ok: true,
    mutated: true,
    project: saved,
    action: plan.action,
    target: plan.args?.target || null,
    before: summarize(current.notes),
    after: summarize(saved.instrumentLab.notes),
    invariants: Object.freeze({
      pitchSequencePreserved: true,
      noteCountPreserved: true,
      presetPreserved: saved.instrumentLab.preset === current.preset,
      bpmPreserved: saved.instrumentLab.bpm === current.bpm,
      baselineRevisionCaptured: true,
      reversible: true,
    }),
    revisionIds: Object.freeze(saved.revisions.slice(-2).map((revision) => revision.id)),
  });
}

export function reshapeInstrumentNotes(notes = [], options = {}) {
  const normalized = normalizeInstrumentState({ notes }).notes;
  return reshapeNotes(normalized, options);
}

function reshapeNotes(notes, { humanize = 0, syncopation = 0, durationVariation = 0 } = {}) {
  const indexed = notes.map((note, index) => ({ ...note, index }));
  const groups = groupByOnset(indexed);
  const onsetShift = new Map();
  const groupIndexByKey = new Map(groups.map((group, index) => [group.key, index]));

  groups.forEach((group, groupIndex) => {
    const pattern = [0, 1, -0.5, 0.75, -0.25, 0.5][groupIndex % 6];
    const humanPattern = [-0.55, 0.35, -0.2, 0.5, -0.35, 0.2][groupIndex % 6];
    const rawShift = pattern * syncopation * 0.11 + humanPattern * humanize * 0.035;
    const previousGap = groupIndex > 0 ? group.start - groups[groupIndex - 1].start : Infinity;
    const nextGap = groupIndex < groups.length - 1 ? groups[groupIndex + 1].start - group.start : Infinity;
    const safeMagnitude = Math.max(0, Math.min(0.12, previousGap * 0.28, nextGap * 0.28));
    onsetShift.set(group.key, clamp(rawShift, -safeMagnitude, safeMagnitude));
  });

  return indexed.map((note) => {
    const key = onsetKey(note.start_beat);
    const groupIndex = groupIndexByKey.get(key) ?? 0;
    const shift = onsetShift.get(key) || 0;
    const velocityPattern = [-1, 0.7, -0.35, 1, -0.55, 0.4][(groupIndex + note.index) % 6];
    const durationPattern = [0.8, -0.45, 1, -0.3, 0.55, -0.7][groupIndex % 6];
    const velocityDelta = Math.round(velocityPattern * humanize * 9);
    const durationScale = 1 + durationPattern * durationVariation * 0.12;
    return {
      midi: note.midi,
      velocity: clamp(Math.round(note.velocity + velocityDelta), 1, 127),
      start_beat: roundBeat(Math.max(0, note.start_beat + shift)),
      duration_beats: roundBeat(Math.max(0.05, note.duration_beats * durationScale)),
    };
  });
}

function groupByOnset(notes) {
  const map = new Map();
  for (const note of notes) {
    const key = onsetKey(note.start_beat);
    if (!map.has(key)) map.set(key, { key, start: Number(note.start_beat), notes: [] });
    map.get(key).notes.push(note);
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

async function loadProjectRuntime() {
  for (const specifier of ['./core/src/project.mjs', '../core/src/project.mjs']) {
    try {
      const module = await import(specifier);
      if (typeof module.migrateProject === 'function' && typeof module.snapshotProject === 'function') return module;
    } catch {
      // Packaged runtime and source tests expose the canonical core from different paths.
    }
  }
  return null;
}

function onsetKey(value) { return Number(value || 0).toFixed(6); }
function roundBeat(value) { return Math.round(Number(value) * 1000000) / 1000000; }

function assertPitchAndCountPreserved(before, after) {
  if (before.length !== after.length) throw new Error('instrument_note_count_drift');
  for (let index = 0; index < before.length; index += 1) {
    if (before[index].midi !== after[index].midi) throw new Error('instrument_pitch_drift');
  }
}

function summarize(notes) {
  return Object.freeze({
    noteCount: notes.length,
    midi: Object.freeze(notes.map((note) => note.midi)),
    starts: Object.freeze(notes.map((note) => note.start_beat)),
    velocities: Object.freeze(notes.map((note) => note.velocity)),
    durations: Object.freeze(notes.map((note) => note.duration_beats)),
  });
}

function blocked(reason) {
  return Object.freeze({ ok: false, mutated: false, reason });
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

export function normalizeGrid(value) {
  const allowed = [0.125, 0.25, 0.5, 1];
  const n = Number(value);
  return allowed.includes(n) ? n : 0.25;
}

export function quantizeNotes(notes = [], grid = 0.25) {
  grid = normalizeGrid(grid);
  return notes.map((note) => ({
    ...note,
    start_beat: snap(Math.max(0, Number(note.start_beat) || 0), grid),
    duration_beats: Math.max(grid, snap(Math.max(0.05, Number(note.duration_beats) || grid), grid)),
  }));
}

export function transposeNotes(notes = [], semitones = 0) {
  const delta = clamp(Math.round(Number(semitones) || 0), -24, 24);
  return notes.map((note) => ({ ...note, midi: clamp(Math.round(Number(note.midi) || 60) + delta, 0, 127) }));
}

export function updateNote(notes = [], index, patch = {}) {
  index = Math.trunc(Number(index));
  if (index < 0 || index >= notes.length) return notes.slice();
  return notes.map((note, i) => i === index ? sanitizeNote({ ...note, ...patch }) : { ...note });
}

export function deleteNote(notes = [], index) {
  index = Math.trunc(Number(index));
  return notes.filter((_, i) => i !== index).map((note) => ({ ...note }));
}

export function noteRange(notes = []) {
  if (!notes.length) return { minMidi: 48, maxMidi: 72, endBeat: 4 };
  const midi = notes.map((n) => clamp(Math.round(Number(n.midi) || 60), 0, 127));
  const endBeat = Math.max(4, ...notes.map((n) => Math.max(0, Number(n.start_beat) || 0) + Math.max(0.05, Number(n.duration_beats) || 0.25)));
  return { minMidi: Math.max(0, Math.min(...midi) - 2), maxMidi: Math.min(127, Math.max(...midi) + 2), endBeat };
}

function sanitizeNote(note = {}) {
  return {
    midi: clamp(Math.round(Number(note.midi) || 60), 0, 127),
    velocity: clamp(Math.round(Number(note.velocity) || 96), 1, 127),
    start_beat: Math.max(0, Number(note.start_beat) || 0),
    duration_beats: Math.max(0.05, Number(note.duration_beats) || 0.25),
  };
}
function snap(value, grid) { return Math.round(value / grid) * grid; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

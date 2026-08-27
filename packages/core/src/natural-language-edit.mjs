import { migrateProject } from './project.mjs';

const SHORT_FADE_SECONDS = 0.25;
const PRESERVATION_CUE = '(?:nao mexe|nao mudar|sem mexer|preserva|mantem)';

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPreservationTarget(text, targets) {
  const target = `(?:${targets.join('|')})`;
  const cueBefore = new RegExp(`${PRESERVATION_CUE}[^.!?,;]{0,40}\\b${target}\\b`);
  const targetBefore = new RegExp(`\\b${target}\\b[^.!?,;]{0,40}${PRESERVATION_CUE}`);
  return cueBefore.test(text) || targetBefore.test(text);
}

function stableSelectedTrack(track) {
  return {
    id: track.id,
    assetId: track.assetId,
    name: track.name,
    type: track.type,
    kind: track.kind,
    createdAt: track.createdAt,
    duration: track.duration,
    sampleRate: track.sampleRate,
    channels: track.channels,
    offset: track.offset,
    trimStart: track.trimStart,
    trimEnd: track.trimEnd,
    gain: track.gain,
    muted: track.muted,
    solo: track.solo,
  };
}

function continuitySnapshot(project, selectedId) {
  const selected = project.tracks.find((track) => track.id === selectedId);
  if (!selected) throw new Error('Faixa selecionada ausente durante verificação de continuidade.');
  return {
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      activeTrackId: project.activeTrackId,
      lyrics: project.lyrics,
      notes: project.notes,
      preset: project.preset,
      trackOrder: project.tracks.map((track) => track.id),
    },
    selectedTrack: stableSelectedTrack(selected),
    otherTracks: project.tracks
      .filter((track) => track.id !== selectedId)
      .map((track) => structuredClone(track)),
  };
}

function assertContinuitySnapshot(expected, project, selectedId) {
  const current = continuitySnapshot(project, selectedId);
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error('Violação de continuidade: uma edição sequencial alterou estrutura ou áudio não selecionado.');
  }
}

export function interpretNaturalLanguageEdit(command) {
  const text = normalizeText(command);
  if (!text) throw new Error('Comando vazio.');

  const operations = [];
  const preserved = new Set();

  if (/\b(limpa|limpar|mais limpa|limpeza)\b/.test(text)) {
    operations.push({ type: 'set_effect', key: 'clean', value: true, evidence: 'clean' });
  }
  if (/\b(presente|presenca|mais presenca|mais presente)\b/.test(text)) {
    operations.push({ type: 'set_effect', key: 'presence', value: true, evidence: 'presence' });
  }
  if (/\b(quente|calor|mais quente)\b/.test(text)) {
    operations.push({ type: 'set_effect', key: 'warm', value: true, evidence: 'warm' });
  }
  if (/\b(sibilancia|sibilante|esses|de-?esser)\b/.test(text) && /\b(menos|reduz|tirar|tira|controla|suaviza)\b/.test(text)) {
    operations.push({ type: 'set_effect', key: 'deEsser', value: true, evidence: 'deEsser' });
  }
  if (/\b(centraliza|centralizada|centralizado|no centro|centro)\b/.test(text)) {
    operations.push({ type: 'set_track', key: 'pan', value: 0, evidence: 'pan_center' });
  }
  if (/\bfade\b/.test(text) && /\b(comeco|inicio|entrada)\b/.test(text) && /\b(curto|rapidinho|bem curto)\b/.test(text)) {
    operations.push({ type: 'set_effect', key: 'fadeIn', value: SHORT_FADE_SECONDS, evidence: 'short_fade_in' });
  }

  if (hasPreservationTarget(text, ['fim', 'final', 'saida'])) {
    preserved.add('trimEnd');
    preserved.add('fadeOut');
  }
  if (hasPreservationTarget(text, ['comeco', 'inicio', 'entrada'])) {
    preserved.add('trimStart');
  }

  if (!operations.length) {
    return {
      supported: false,
      normalized_command: text,
      operations: [],
      preserved: [...preserved],
      reason: 'Nenhuma operação segura e determinística foi reconhecida.',
    };
  }

  return {
    supported: true,
    normalized_command: text,
    operations,
    preserved: [...preserved],
    reason: null,
  };
}

export function executeNaturalLanguageEdit(project, command, { trackId = null, now = Date.now() } = {}) {
  const intent = interpretNaturalLanguageEdit(command);
  if (!intent.supported) throw new Error(intent.reason);

  const next = migrateProject(project);
  const selectedId = trackId || next.activeTrackId;
  const track = next.tracks.find((candidate) => candidate.id === selectedId);
  if (!track) throw new Error('Nenhuma faixa ativa foi encontrada para aplicar o comando.');

  const before = {
    trimStart: track.trimStart,
    trimEnd: track.trimEnd,
    fadeOut: track.effects.fadeOut,
  };

  for (const operation of intent.operations) {
    if (operation.type === 'set_effect') track.effects[operation.key] = operation.value;
    else if (operation.type === 'set_track') track[operation.key] = operation.value;
    else throw new Error(`Operação não suportada: ${operation.type}`);
  }

  for (const key of intent.preserved) {
    if (key === 'trimStart' && track.trimStart !== before.trimStart) throw new Error('Violação de preservação: trimStart.');
    if (key === 'trimEnd' && track.trimEnd !== before.trimEnd) throw new Error('Violação de preservação: trimEnd.');
    if (key === 'fadeOut' && track.effects.fadeOut !== before.fadeOut) throw new Error('Violação de preservação: fadeOut.');
  }

  track.updatedAt = now;
  next.updatedAt = now;
  return {
    project: next,
    track_id: track.id,
    intent,
    applied_operations: intent.operations,
    preserved: intent.preserved,
  };
}

export function executeNaturalLanguageEditSequence(project, commands, { trackId = null, now = Date.now() } = {}) {
  if (!Array.isArray(commands) || commands.length < 2) throw new Error('A sequência precisa de pelo menos duas edições.');
  let current = migrateProject(project);
  const selectedId = trackId || current.activeTrackId;
  if (!current.tracks.some((track) => track.id === selectedId)) throw new Error('Nenhuma faixa ativa foi encontrada para a sequência.');

  const continuity = continuitySnapshot(current, selectedId);
  const steps = [];

  commands.forEach((command, index) => {
    const result = executeNaturalLanguageEdit(current, command, { trackId: selectedId, now: now + index });
    current = result.project;
    assertContinuitySnapshot(continuity, current, selectedId);
    steps.push({
      index: index + 1,
      command,
      applied_operations: result.applied_operations,
      preserved: result.preserved,
    });
  });

  return {
    project: current,
    track_id: selectedId,
    steps,
    continuity: {
      structural_identity_preserved: true,
      other_tracks_preserved: true,
      selected_track_source_identity_preserved: true,
      trim_and_timeline_preserved: true,
    },
  };
}

export const NATURAL_LANGUAGE_EDIT_LIMITS = Object.freeze({
  language: 'pt-BR',
  deterministic: true,
  supported_operations: Object.freeze([
    'clean_on',
    'presence_on',
    'warm_on',
    'de_esser_on',
    'pan_center',
    'short_fade_in',
    'preserve_trim_start',
    'preserve_trim_end',
    'preserve_fade_out',
    'sequential_continuity_guard',
  ]),
  unsupported_requests_must_fail_closed: true,
});

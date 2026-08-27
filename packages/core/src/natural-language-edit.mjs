import { migrateProject } from './project.mjs';

const SHORT_FADE_SECONDS = 0.25;

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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
  if (/\bnao mexe|nao mudar|sem mexer|preserva|mantem\b/.test(text)) {
    if (/\b(fim|final|saida)\b/.test(text)) {
      preserved.add('trimEnd');
      preserved.add('fadeOut');
    }
    if (/\b(comeco|inicio|entrada)\b/.test(text)) {
      preserved.add('trimStart');
    }
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
  ]),
  unsupported_requests_must_fail_closed: true,
});

export const SINGER_PROFILE_SCHEMA = 'pablovoice_singer_profile_v1';

export function normalizeSingerProfile(input = {}) {
  const voiceType = allowed(input.voiceType, ['masculina', 'feminina', 'neutra'], 'masculina');
  const lowMidi = clamp(Math.round(Number(input.lowMidi) || 48), 36, 84);
  const highMidi = clamp(Math.round(Number(input.highMidi) || 67), lowMidi + 5, 96);
  return Object.freeze({
    schema: SINGER_PROFILE_SCHEMA,
    voiceType,
    lowMidi,
    highMidi,
    tone: clean(input.tone, 100) || 'natural e próxima',
    delivery: clean(input.delivery, 140) || 'dicção clara e interpretação confortável',
    language: clean(input.language, 16) || 'pt-BR',
    falsetto: Boolean(input.falsetto),
  });
}

function clean(value, max) { return String(value || '').trim().slice(0, max); }
function allowed(value, choices, fallback) { const normalized = clean(value, 24).toLowerCase(); return choices.includes(normalized) ? normalized : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

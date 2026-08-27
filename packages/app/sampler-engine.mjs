export const SAMPLER_SCHEMA = 'pablovoice_sampler_v1';
export const DEFAULT_MAX_PADS = 16;

export function createSamplerState(plan = {}, { maxPads = DEFAULT_MAX_PADS } = {}) {
  const sourceAssetId = plan?.sourceAssetId || null;
  const slices = Array.isArray(plan?.slices) ? plan.slices : [];
  const limit = clamp(Math.floor(Number(maxPads) || DEFAULT_MAX_PADS), 1, 32);
  const pads = slices.slice(0, limit).map((slice, index) => normalizePad({
    id: `pad_${index + 1}`,
    sliceId: slice?.id || `slice_${index + 1}`,
    sourceAssetId,
    label: `Pad ${index + 1}`,
    start: slice?.start,
    end: slice?.end,
    gain: 1,
    fadeIn: 0.005,
    fadeOut: 0.01,
    playbackRate: 1,
    source: 'audio_onset',
  }, index, sourceAssetId));
  return {
    schema: SAMPLER_SCHEMA,
    sourceAssetId,
    analysisSchemaVersion: plan?.analysisSchemaVersion || null,
    selectedPadId: pads[0]?.id || null,
    pads,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function normalizeSamplerState(input = {}) {
  const sourceAssetId = input?.sourceAssetId || null;
  const pads = Array.isArray(input?.pads)
    ? input.pads.slice(0, 32).map((pad, index) => normalizePad(pad, index, sourceAssetId))
    : [];
  const selectedPadId = pads.some((pad) => pad.id === input?.selectedPadId)
    ? input.selectedPadId
    : pads[0]?.id || null;
  return {
    schema: SAMPLER_SCHEMA,
    sourceAssetId,
    analysisSchemaVersion: input?.analysisSchemaVersion || null,
    selectedPadId,
    pads,
    createdAt: finite(input?.createdAt, Date.now()),
    updatedAt: finite(input?.updatedAt, Date.now()),
  };
}

export function updateSamplerPad(state, padId, patch = {}) {
  const normalized = normalizeSamplerState(state);
  const pads = normalized.pads.map((pad, index) => {
    if (pad.id !== padId) return pad;
    return normalizePad({ ...pad, ...patch }, index, normalized.sourceAssetId);
  });
  return {
    ...normalized,
    pads,
    selectedPadId: pads.some((pad) => pad.id === padId) ? padId : normalized.selectedPadId,
    updatedAt: Date.now(),
  };
}

export function selectSamplerPad(state, padId) {
  const normalized = normalizeSamplerState(state);
  if (!normalized.pads.some((pad) => pad.id === padId)) return normalized;
  return { ...normalized, selectedPadId: padId, updatedAt: Date.now() };
}

export function samplerPadDuration(pad = {}) {
  return Math.max(0, finite(pad.end, 0) - finite(pad.start, 0));
}

function normalizePad(input = {}, index = 0, fallbackAssetId = null) {
  const start = Math.max(0, finite(input?.start, 0));
  const end = Math.max(start + 0.01, finite(input?.end, start + 0.1));
  const duration = end - start;
  const fadeIn = clamp(finite(input?.fadeIn, 0.005), 0, duration / 2);
  const fadeOut = clamp(finite(input?.fadeOut, 0.01), 0, duration / 2);
  return {
    id: String(input?.id || `pad_${index + 1}`),
    sliceId: String(input?.sliceId || `slice_${index + 1}`),
    sourceAssetId: input?.sourceAssetId || fallbackAssetId || null,
    label: String(input?.label || `Pad ${index + 1}`).slice(0, 40),
    start,
    end,
    gain: clamp(finite(input?.gain, 1), 0, 2),
    fadeIn,
    fadeOut,
    playbackRate: clamp(finite(input?.playbackRate, 1), 0.25, 4),
    source: String(input?.source || 'audio_onset'),
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

import { analyzeFormants } from '../analyzers/formants.mjs';

export const CLEANUP_LOCAL_EVIDENCE_PROFILE = Object.freeze({
  source: 'vocal-cleanup-local-evidence-v1',
  maxFormantProbeSeconds: 8,
  clippingAmplitude: 1,
});

/**
 * Derives the acoustic facts that can be proven locally from the exact original
 * and processed AudioBuffers. Identity remains intentionally external: this
 * helper never invents a speaker match.
 */
export function deriveVocalCleanupLocalEvidence({
  originalBuffer,
  processedBuffer,
  events = [],
  reference = {},
  candidate = {},
  alignment = {},
  formantOptions = {},
} = {}) {
  assertAudioBuffer(originalBuffer, 'Original');
  assertAudioBuffer(processedBuffer, 'Processed');

  const regions = normalizeRegions(events, originalBuffer.duration ?? originalBuffer.length / originalBuffer.sampleRate);
  const structuralSameContent = originalBuffer.length === processedBuffer.length
    && originalBuffer.sampleRate === processedBuffer.sampleRate;
  const referenceTechnical = measureBufferRegion(originalBuffer, regions);
  const candidateTechnical = measureBufferRegion(processedBuffer, regions);
  const referenceFormants = analyzeFormants(
    buildMonoProbe(originalBuffer, regions, CLEANUP_LOCAL_EVIDENCE_PROFILE.maxFormantProbeSeconds),
    { sampleRate: originalBuffer.sampleRate, ...formantOptions },
  );
  const candidateFormants = analyzeFormants(
    buildMonoProbe(processedBuffer, regions, CLEANUP_LOCAL_EVIDENCE_PROFILE.maxFormantProbeSeconds),
    { sampleRate: processedBuffer.sampleRate, ...formantOptions },
  );

  const resolvedReference = Object.freeze({
    ...reference,
    durationSeconds: durationSeconds(originalBuffer),
    formantsHz: resolveFormants(reference?.formantsHz, referenceFormants),
  });
  const resolvedCandidate = Object.freeze({
    ...candidate,
    durationSeconds: durationSeconds(processedBuffer),
    peak: candidateTechnical.peak,
    clippingRatio: candidateTechnical.clippingRatio,
    formantsHz: resolveFormants(candidate?.formantsHz, candidateFormants),
  });
  const resolvedAlignment = Object.freeze({
    ...alignment,
    sameContent: alignment?.sameContent === false ? false : structuralSameContent,
  });

  return Object.freeze({
    source: CLEANUP_LOCAL_EVIDENCE_PROFILE.source,
    reference: resolvedReference,
    candidate: resolvedCandidate,
    alignment: resolvedAlignment,
    local: Object.freeze({
      structuralSameContent,
      regions: Object.freeze(regions.map((region) => Object.freeze({ ...region }))),
      referenceTechnical,
      candidateTechnical,
      referenceFormants,
      candidateFormants,
    }),
  });
}

function measureBufferRegion(buffer, regions) {
  let peak = 0;
  let clipped = 0;
  let total = 0;
  for (const region of regions) {
    const start = Math.max(0, Math.floor(region.startSeconds * buffer.sampleRate));
    const end = Math.min(buffer.length, Math.ceil(region.endSeconds * buffer.sampleRate));
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = start; index < end; index += 1) {
        const magnitude = Math.abs(Number(samples[index]) || 0);
        if (magnitude > peak) peak = magnitude;
        if (magnitude > CLEANUP_LOCAL_EVIDENCE_PROFILE.clippingAmplitude) clipped += 1;
        total += 1;
      }
    }
  }
  return Object.freeze({
    peak: roundSix(peak),
    clippingRatio: total ? roundEight(clipped / total) : 0,
    sampleCount: total,
  });
}

function buildMonoProbe(buffer, regions, maxSeconds) {
  const maxSamples = Math.max(256, Math.floor(buffer.sampleRate * maxSeconds));
  const spans = regions.map((region) => ({
    start: Math.max(0, Math.floor(region.startSeconds * buffer.sampleRate)),
    end: Math.min(buffer.length, Math.ceil(region.endSeconds * buffer.sampleRate)),
  })).filter((span) => span.end > span.start);
  const available = spans.reduce((sum, span) => sum + span.end - span.start, 0);
  const target = Math.min(maxSamples, available || buffer.length);
  const output = new Float32Array(target);
  if (!target) return output;

  const sourceSpans = spans.length ? spans : [{ start: 0, end: buffer.length }];
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  let write = 0;
  let remainingAvailable = sourceSpans.reduce((sum, span) => sum + span.end - span.start, 0);
  for (let spanIndex = 0; spanIndex < sourceSpans.length && write < target; spanIndex += 1) {
    const span = sourceSpans[spanIndex];
    const spanLength = span.end - span.start;
    const remainingTarget = target - write;
    const take = spanIndex === sourceSpans.length - 1
      ? Math.min(spanLength, remainingTarget)
      : Math.min(spanLength, Math.max(1, Math.round(remainingTarget * spanLength / Math.max(1, remainingAvailable))));
    const offset = span.start + Math.max(0, Math.floor((spanLength - take) / 2));
    for (let index = 0; index < take && write < target; index += 1) {
      let mixed = 0;
      for (const channel of channels) mixed += Number(channel[offset + index]) || 0;
      output[write] = mixed / Math.max(1, channels.length);
      write += 1;
    }
    remainingAvailable -= spanLength;
  }
  return write === output.length ? output : output.slice(0, write);
}

function normalizeRegions(events, duration) {
  const normalized = (Array.isArray(events) ? events : [])
    .filter((event) => event?.enabled !== false)
    .map((event) => ({
      startSeconds: clamp(Number(event.startSeconds), 0, duration),
      endSeconds: clamp(Number(event.endSeconds), 0, duration),
    }))
    .filter((region) => region.endSeconds > region.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  if (!normalized.length) return [{ startSeconds: 0, endSeconds: duration }];

  const merged = [];
  for (const region of normalized) {
    const previous = merged.at(-1);
    if (previous && region.startSeconds <= previous.endSeconds) {
      previous.endSeconds = Math.max(previous.endSeconds, region.endSeconds);
    } else {
      merged.push({ ...region });
    }
  }
  return merged;
}

function resolveFormants(provided, local) {
  if (Array.isArray(provided) && provided.length >= 3 && provided.slice(0, 3).every((value) => Number(value) > 0)) {
    return provided.slice(0, 3).map(Number);
  }
  return local?.stable ? local.formantsHz : [];
}

function durationSeconds(buffer) {
  const value = Number(buffer.duration);
  return Number.isFinite(value) && value > 0 ? value : buffer.length / buffer.sampleRate;
}

function assertAudioBuffer(buffer, label) {
  if (!buffer || typeof buffer.getChannelData !== 'function' || !Number.isFinite(buffer.sampleRate)
    || buffer.sampleRate <= 0 || !Number.isFinite(buffer.length) || buffer.length <= 0
    || !Number.isFinite(buffer.numberOfChannels) || buffer.numberOfChannels <= 0) {
    throw new TypeError(`${label} AudioBuffer válido é necessário para evidência local de cleanup.`);
  }
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
function roundSix(value) { return Math.round((Number(value) || 0) * 1e6) / 1e6; }
function roundEight(value) { return Math.round((Number(value) || 0) * 1e8) / 1e8; }

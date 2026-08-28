export const REGIONAL_VOCAL_DENOISE_KIND = 'vocal_denoise';
export const REGIONAL_VOCAL_DEREVERB_KIND = 'vocal_dereverb';

export function regionalVocalDenoiseEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.enabled !== false && event?.kind === REGIONAL_VOCAL_DENOISE_KIND)
    .map(normalizeVocalDenoiseEvent)
    .filter((event) => event.endSeconds > event.startSeconds && event.confidence >= 0.72 && event.timbreProtected);
}

export function regionalVocalDereverbEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.enabled !== false && event?.kind === REGIONAL_VOCAL_DEREVERB_KIND)
    .map(normalizeVocalDereverbEvent)
    .filter((event) => event.endSeconds > event.startSeconds && event.confidence >= 0.72 && event.timbreProtected);
}

export function normalizeVocalDenoiseEvent(event = {}) {
  const base = normalizeBase(event, REGIONAL_VOCAL_DENOISE_KIND);
  const thresholdDb = clamp(finite(event.thresholdDb, -42), -72, -18);
  const voicedLevelDb = clamp(finite(event.voicedLevelDb, -18), -60, 0);
  const voicedMarginDb = voicedLevelDb - thresholdDb;
  const rawReductionDb = Number(event.reductionDb);
  const rawSnrDb = Number(event.snrDb);
  const rawGuardSource = String(event.guardSource || '');
  return {
    ...base,
    thresholdDb,
    reductionDb: clamp(finite(event.reductionDb, 3), 0, 5.5),
    attackSeconds: clamp(finite(event.attackSeconds, 0.008), 0.003, 0.03),
    releaseSeconds: clamp(finite(event.releaseSeconds, 0.12), 0.06, 0.28),
    noiseFloorDb: clamp(finite(event.noiseFloorDb, -48), -90, -18),
    voicedLevelDb,
    snrDb: clamp(finite(event.snrDb, voicedMarginDb), 0, 60),
    voicedMarginDb: clamp(finite(event.voicedMarginDb, voicedMarginDb), 0, 60),
    timbreProtected: event.timbreProtected === true
      && rawReductionDb > 0
      && rawReductionDb <= 5.5
      && rawSnrDb >= 5.5
      && rawSnrDb <= 29
      && voicedMarginDb >= 10
      && rawGuardSource === 'bounded-vocal-timbre-guard-v1',
    guardSource: String(event.guardSource || 'bounded-vocal-timbre-guard-v1'),
  };
}

export function normalizeVocalDereverbEvent(event = {}) {
  const base = normalizeBase(event, REGIONAL_VOCAL_DEREVERB_KIND);
  const rawDelayMs = Number(event.reflectionDelayMs);
  const rawAmount = Number(event.amount);
  const rawCorrelation = Number(event.correlation);
  const rawProminence = Number(event.prominence);
  const rawGuardSource = String(event.guardSource || '');
  return {
    ...base,
    reflectionDelayMs: clamp(finite(event.reflectionDelayMs, 36), 18, 90),
    amount: clamp(finite(event.amount, 0.1), 0, 0.2),
    dampingHz: clamp(finite(event.dampingHz, 5200), 2800, 6500),
    correlation: clamp(finite(event.correlation, 0), 0, 1),
    prominence: clamp(finite(event.prominence, 0), 0, 1),
    timbreProtected: event.timbreProtected === true
      && rawDelayMs >= 18
      && rawDelayMs <= 90
      && rawAmount > 0
      && rawAmount <= 0.2
      && rawCorrelation >= 0.1
      && rawProminence >= 0.04
      && rawGuardSource === 'bounded-vocal-timbre-guard-v1',
    guardSource: String(event.guardSource || 'bounded-vocal-timbre-guard-v1'),
  };
}

export function restorationEventFingerprint(events = []) {
  const normalized = [
    ...regionalVocalDenoiseEvents(events),
    ...regionalVocalDereverbEvents(events),
  ].sort((a, b) => a.startSeconds - b.startSeconds || a.kind.localeCompare(b.kind));
  return JSON.stringify(normalized.map((event) => {
    if (event.kind === REGIONAL_VOCAL_DENOISE_KIND) return [
      event.id, event.kind, event.startSeconds, event.endSeconds, event.thresholdDb, event.reductionDb,
      event.attackSeconds, event.releaseSeconds, event.confidence, event.timbreProtected,
    ];
    return [
      event.id, event.kind, event.startSeconds, event.endSeconds, event.reflectionDelayMs, event.amount,
      event.dampingHz, event.confidence, event.timbreProtected,
    ];
  }));
}

export function cloneWithVocalRestoration(context, buffer, events = []) {
  const denoise = regionalVocalDenoiseEvents(events);
  const dereverb = regionalVocalDereverbEvents(events);
  if (!denoise.length && !dereverb.length) return { buffer, applied: false, denoiseCount: 0, dereverbCount: 0 };
  if (!context?.createBuffer || !buffer?.getChannelData) throw new TypeError('AudioBuffer válido é necessário para restauração vocal.');

  const output = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = output.getChannelData(channel);
    samples.set(buffer.getChannelData(channel));
    applyVocalRestorationInPlace(samples, { sampleRate: buffer.sampleRate, denoise, dereverb });
  }
  return { buffer: output, applied: true, denoiseCount: denoise.length, dereverbCount: dereverb.length };
}

export function applyVocalRestorationInPlace(samples, { sampleRate = 48000, denoise = [], dereverb = [] } = {}) {
  if (!samples || typeof samples.length !== 'number' || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('PCM e sample rate válidos são necessários para restauração vocal.');
  }
  for (const event of denoise.map(normalizeVocalDenoiseEvent)) applyDenoise(samples, event, sampleRate);
  for (const event of dereverb.map(normalizeVocalDereverbEvent)) applyDereverb(samples, event, sampleRate);
  return samples;
}

function applyDenoise(samples, event, sampleRate) {
  if (!event.timbreProtected || event.confidence < 0.72 || event.reductionDb <= 0) return;
  const start = clampIndex(event.startSeconds * sampleRate, samples.length);
  const end = clampIndex(event.endSeconds * sampleRate, samples.length);
  if (end <= start) return;
  const threshold = 10 ** (event.thresholdDb / 20);
  const minimumGain = 10 ** (-event.reductionDb / 20);
  const attackCoefficient = Math.exp(-1 / Math.max(1, event.attackSeconds * sampleRate));
  const releaseCoefficient = Math.exp(-1 / Math.max(1, event.releaseSeconds * sampleRate));
  const openCoefficient = Math.exp(-1 / Math.max(1, 0.004 * sampleRate));
  const closeCoefficient = Math.exp(-1 / Math.max(1, 0.02 * sampleRate));
  const fadeSamples = Math.max(1, Math.floor(sampleRate * 0.012));
  const preRoll = Math.max(0, start - Math.floor(event.releaseSeconds * sampleRate * 2));
  let envelope = 0;
  let gain = 1;
  for (let index = preRoll; index < end; index += 1) {
    const sample = Number(samples[index]) || 0;
    const magnitude = Math.abs(sample);
    const envelopeCoefficient = magnitude > envelope ? attackCoefficient : releaseCoefficient;
    envelope = envelopeCoefficient * envelope + (1 - envelopeCoefficient) * magnitude;
    const ratio = threshold > 1e-9 ? envelope / threshold : 1;
    const quiet = 1 - smoothStep(0.55, 1, ratio);
    const targetGain = minimumGain + (1 - minimumGain) * (1 - quiet);
    const gainCoefficient = targetGain > gain ? openCoefficient : closeCoefficient;
    gain = gainCoefficient * gain + (1 - gainCoefficient) * targetGain;
    if (index < start) continue;
    const edge = edgeMix(index, start, end, fadeSamples);
    samples[index] = sample * (1 + (gain - 1) * edge);
  }
}

function applyDereverb(samples, event, sampleRate) {
  if (!event.timbreProtected || event.confidence < 0.72 || event.amount <= 0) return;
  const start = clampIndex(event.startSeconds * sampleRate, samples.length);
  const end = clampIndex(event.endSeconds * sampleRate, samples.length);
  const delaySamples = Math.max(1, Math.round(event.reflectionDelayMs * sampleRate / 1000));
  const processStart = Math.max(start, delaySamples);
  if (end <= processStart) return;
  const fadeSamples = Math.max(1, Math.floor(sampleRate * 0.015));
  const lowpassAlpha = 1 - Math.exp(-2 * Math.PI * event.dampingHz / sampleRate);
  let delayedLowpass = Number(samples[Math.max(0, processStart - delaySamples - 1)]) || 0;
  const warmStart = Math.max(delaySamples, processStart - delaySamples * 2);
  for (let index = warmStart; index < processStart; index += 1) {
    const delayed = Number(samples[index - delaySamples]) || 0;
    delayedLowpass += lowpassAlpha * (delayed - delayedLowpass);
  }
  for (let index = processStart; index < end; index += 1) {
    const input = Number(samples[index]) || 0;
    const delayed = Number(samples[index - delaySamples]) || 0;
    delayedLowpass += lowpassAlpha * (delayed - delayedLowpass);
    const edge = edgeMix(index, start, end, fadeSamples);
    samples[index] = input - event.amount * edge * delayedLowpass;
  }
}

function normalizeBase(event, kind) {
  const start = Math.max(0, finite(event.startSeconds, 0));
  const end = Math.max(start, finite(event.endSeconds, start));
  return {
    ...event,
    kind,
    startSeconds: start,
    endSeconds: end,
    confidence: clamp(finite(event.confidence, 0), 0, 1),
    enabled: event.enabled !== false,
  };
}

function edgeMix(index, start, end, fadeSamples) {
  const fadeIn = clamp((index - start + 1) / fadeSamples, 0, 1);
  const fadeOut = clamp((end - index) / fadeSamples, 0, 1);
  return Math.min(fadeIn, fadeOut);
}
function smoothStep(edge0, edge1, value) {
  const amount = clamp((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}
function clampIndex(value, length) { return Math.max(0, Math.min(length, Math.round(Number(value) || 0))); }
function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }

export function analyzeVoice({ pitchContour = [], breathEvents = [], sibilanceEvents = [], plosiveEvents = [], peakEvents = [], clickEvents = [], formants = [], snrDb = null, roomReverb = null } = {}) {
  const voiced = pitchContour.filter((point) => point?.voiced && Number.isFinite(point.hz));
  const hzValues = voiced.map((point) => point.hz).sort((a,b)=>a-b);
  const confidence = voiced.length ? voiced.reduce((sum, point) => sum + (Number(point.confidence) || 0), 0) / voiced.length : 0;
  const medianHz = percentile(hzValues, 0.5);
  const lowHz = percentile(hzValues, 0.05);
  const highHz = percentile(hzValues, 0.95);
  const stability = pitchStability(voiced);
  return {
    voicedRatio: pitchContour.length ? voiced.length / pitchContour.length : 0,
    pitchHz: medianHz,
    rangeHz: lowHz === null || highHz === null ? null : [lowHz, highHz],
    pitchStability: stability,
    pitchConfidence: confidence,
    snrDb: finiteOrNull(snrDb),
    roomReverb: finiteOrNull(roomReverb),
    breathEvents: normalizeEvents(breathEvents),
    sibilanceEvents: normalizeEvents(sibilanceEvents),
    plosiveEvents: normalizeEvents(plosiveEvents),
    peakEvents: normalizeEvents(peakEvents),
    clickEvents: normalizeEvents(clickEvents),
    formants: Array.isArray(formants) ? formants : [],
    confidence
  };
}

export function classifyBreathAction(event, { autoThreshold = 0.82, suggestThreshold = 0.55 } = {}) {
  const confidence = Number(event?.confidence) || 0;
  const intensity = Number(event?.intensity) || 0;
  if (confidence >= autoThreshold && intensity >= 0.7) return { action: 'soften', mode: 'auto', confidence };
  if (confidence >= suggestThreshold) return { action: 'soften', mode: 'suggest', confidence };
  return { action: 'keep', mode: 'manual', confidence };
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(Boolean).map((event) => {
    const normalized = {
      start: finiteOrNull(event.start ?? event.time),
      end: finiteOrNull(event.end ?? event.time),
      intensity: finiteOrNull(event.intensity),
      confidence: finiteOrNull(event.confidence)
    };
    const frequencyHz = finiteOrNull(event.frequencyHz);
    const spectralPeakHz = finiteOrNull(event.spectralPeakHz);
    const spectralSpreadHz = finiteOrNull(event.spectralSpreadHz);
    const spectralConfidence = finiteOrNull(event.spectralConfidence);
    const peak = finiteOrNull(event.peak);
    const rms = finiteOrNull(event.rms);
    const transientRise = finiteOrNull(event.transientRise);
    const differenceRatio = finiteOrNull(event.differenceRatio);
    const lowFrequencyRatio = finiteOrNull(event.lowFrequencyRatio);
    if (frequencyHz !== null) normalized.frequencyHz = frequencyHz;
    if (spectralPeakHz !== null) normalized.spectralPeakHz = spectralPeakHz;
    if (spectralSpreadHz !== null) normalized.spectralSpreadHz = spectralSpreadHz;
    if (spectralConfidence !== null) normalized.spectralConfidence = spectralConfidence;
    if (peak !== null) normalized.peak = peak;
    if (rms !== null) normalized.rms = rms;
    if (transientRise !== null) normalized.transientRise = transientRise;
    if (differenceRatio !== null) normalized.differenceRatio = differenceRatio;
    if (lowFrequencyRatio !== null) normalized.lowFrequencyRatio = lowFrequencyRatio;
    if (event.spectralSource) normalized.spectralSource = String(event.spectralSource);
    if (event.source) normalized.source = String(event.source);
    return normalized;
  });
}

function pitchStability(points) {
  const midi = points.map((point) => Number(point.midi)).filter(Number.isFinite);
  if (midi.length < 2) return null;
  const mean = midi.reduce((sum, value) => sum + value, 0) / midi.length;
  const variance = midi.reduce((sum, value) => sum + (value - mean) ** 2, 0) / midi.length;
  return 1 / (1 + Math.sqrt(variance));
}

function percentile(values, p) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * p)));
  return values[index];
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

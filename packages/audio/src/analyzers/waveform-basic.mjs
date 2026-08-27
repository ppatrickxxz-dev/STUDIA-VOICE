export function analyzeWaveform(samples, { sampleRate = 48000, silenceThreshold = 0.001 } = {}) {
  if (!samples || typeof samples.length !== 'number' || samples.length === 0) throw new Error('samples are required');
  let peak = 0;
  let sumSquares = 0;
  let silent = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = Number(samples[i]) || 0;
    const a = Math.abs(x);
    if (a > peak) peak = a;
    sumSquares += x * x;
    if (a <= silenceThreshold) silent += 1;
    if (a >= 0.999) clipped += 1;
  }
  return {
    durationSeconds: samples.length / sampleRate,
    signal: {
      peak: { value: peak, confidence: 1, valid: true },
      rms: { value: Math.sqrt(sumSquares / samples.length), confidence: 1, valid: true },
      silenceRatio: { value: silent / samples.length, confidence: 1, valid: true },
      clippingRatio: { value: clipped / samples.length, confidence: 1, valid: true }
    }
  };
}

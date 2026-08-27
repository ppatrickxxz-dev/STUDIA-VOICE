export function detectOnsets(samples, { sampleRate = 48000, frameSize = 1024, hopSize = 512, threshold = 2.5 } = {}) {
  if (!samples || samples.length < frameSize) return [];
  const energies = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    let sum = 0;
    for (let i = offset; i < offset + frameSize; i += 1) {
      const x = Number(samples[i]) || 0;
      sum += x * x;
    }
    energies.push(Math.sqrt(sum / frameSize));
  }
  const flux = energies.map((e, i) => i === 0 ? 0 : Math.max(0, e - energies[i - 1]));
  const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
  const variance = flux.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, flux.length);
  const gate = mean + Math.sqrt(variance) * threshold;
  const events = [];
  for (let i = 1; i < flux.length - 1; i += 1) {
    if (flux[i] >= gate && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) events.push({ timeSeconds: (i * hopSize) / sampleRate, strength: flux[i], confidence: gate > 0 ? Math.min(1, flux[i] / (gate * 2)) : 0.5 });
  }
  return events;
}

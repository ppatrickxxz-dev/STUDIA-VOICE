export const EXPORT_PRESETS = Object.freeze({
  music: { label: 'Música', sampleRate: 48000, peak: 0.96 },
  demo: { label: 'Demo', sampleRate: 44100, peak: 0.94 },
  podcast: { label: 'Podcast', sampleRate: 48000, peak: 0.89 },
  video: { label: 'Vídeo', sampleRate: 48000, peak: 0.93 },
  streaming: { label: 'Streaming', sampleRate: 44100, peak: 0.89 },
});

export const EFFECT_LABELS = Object.freeze({
  clean: 'Limpar voz', warm: 'Calor', presence: 'Presença', normalize: 'Normalizar',
  compressor: 'Compressão', deEsser: 'De-esser', saturation: 'Saturação', double: 'Double',
});

export function peakOf(buffer, maxSamples = 350_000) {
  if (!buffer) return 0;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const step = Math.max(1, Math.floor(data.length / maxSamples));
    for (let index = 0; index < data.length; index += step) peak = Math.max(peak, Math.abs(data[index]));
  }
  return peak;
}

export function normalizationFactor(buffer, target = 0.96) {
  const peak = peakOf(buffer);
  if (peak < 0.00001) return 1;
  return Math.max(0.25, Math.min(2, target / peak));
}

export function encodeWav(buffer) {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const byteLength = 44 + frames * channels * 2;
  const array = new ArrayBuffer(byteLength);
  const view = new DataView(array);
  let position = 0;
  const string = (value) => { for (const char of value) view.setUint8(position++, char.charCodeAt(0)); };
  string('RIFF');
  view.setUint32(position, byteLength - 8, true); position += 4;
  string('WAVEfmt ');
  view.setUint32(position, 16, true); position += 4;
  view.setUint16(position, 1, true); position += 2;
  view.setUint16(position, channels, true); position += 2;
  view.setUint32(position, sampleRate, true); position += 4;
  view.setUint32(position, sampleRate * channels * 2, true); position += 4;
  view.setUint16(position, channels * 2, true); position += 2;
  view.setUint16(position, 16, true); position += 2;
  string('data');
  view.setUint32(position, frames * channels * 2, true); position += 4;
  const source = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, source[channel][frame] || 0));
      view.setInt16(position, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      position += 2;
    }
  }
  return array;
}

export function wavHeader(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const text = (offset, length) => String.fromCharCode(...new Uint8Array(arrayBuffer, offset, length));
  return {
    riff: text(0, 4), wave: text(8, 4), format: view.getUint16(20, true),
    channels: view.getUint16(22, true), sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true), dataBytes: view.getUint32(40, true),
  };
}


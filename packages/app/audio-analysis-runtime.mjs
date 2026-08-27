import { getAudioAsset } from './storage.mjs';
import { analyzeWaveform } from './audio/src/analyzers/waveform-basic.mjs';
import { detectOnsets } from './audio/src/analyzers/onset-basic.mjs';
import { analyzeMusicalAudio } from './audio/src/analyzers/pipeline.mjs';

export async function analyzeAudioTrack(track) {
  if (!track?.assetId) throw new Error('Escolha uma faixa de áudio primeiro.');
  const asset = await getAudioAsset(track.assetId);
  if (!asset?.blob) throw new Error('O arquivo dessa faixa não está disponível no aparelho.');
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) throw new Error('A análise musical não está disponível neste aparelho.');
  const context = new AudioCtx();
  try {
    const bytes = await asset.blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const samples = buffer.getChannelData(0);
    const waveform = analyzeWaveform(samples, { sampleRate: buffer.sampleRate });
    const onsets = detectOnsets(samples, { sampleRate: buffer.sampleRate });
    const musical = analyzeMusicalAudio({
      samples,
      sampleRate: buffer.sampleRate,
      onsets,
      durationSeconds: buffer.duration,
    });
    return {
      schemaVersion: 2,
      assetId: track.assetId,
      source: {
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        durationSeconds: buffer.duration,
      },
      music: musical.music,
      signal: { ...waveform.signal, onsets, transients: onsets },
      voice: musical.voice,
      confidence: musical.confidence,
      validity: { complete: true, invalidatedRanges: [] },
    };
  } finally {
    context.close?.().catch?.(() => {});
  }
}

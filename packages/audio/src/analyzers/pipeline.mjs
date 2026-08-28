import { analyzePitch } from './pitch.mjs';
import { analyzeTempo } from './tempo.mjs';
import { analyzeVoice } from './voice.mjs';
import { detectBreathAndSibilance } from './breath-sibilance.mjs';
import { detectPlosives } from './plosive.mjs';
import { detectVocalPeaks } from './vocal-peaks.mjs';
import { detectVocalClicks } from './vocal-clicks.mjs';

const DEFAULT_INTERACTIVE_PITCH_OPTIONS = Object.freeze({ hopSize: 2048 });

export function analyzeMusicalAudio({
  samples,
  sampleRate,
  onsets = [],
  breathEvents = null,
  sibilanceEvents = null,
  plosiveEvents = null,
  peakEvents = null,
  clickEvents = null,
  formants = [],
  durationSeconds = null,
  pitchOptions = DEFAULT_INTERACTIVE_PITCH_OPTIONS,
  breathDetectionOptions = undefined,
  plosiveDetectionOptions = undefined,
  peakDetectionOptions = undefined,
  clickDetectionOptions = undefined,
} = {}) {
  const pitch = analyzePitch(samples, sampleRate, pitchOptions);
  const tempo = analyzeTempo(onsets, { durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : (samples?.length && sampleRate ? samples.length / sampleRate : null) });
  const needsBreathDetection = !Array.isArray(breathEvents) || !Array.isArray(sibilanceEvents);
  const detected = needsBreathDetection
    ? detectBreathAndSibilance(samples, { sampleRate, ...(breathDetectionOptions || {}) })
    : { breathEvents: [], sibilanceEvents: [] };
  const needsPlosiveDetection = !Array.isArray(plosiveEvents);
  const detectedPlosives = needsPlosiveDetection
    ? detectPlosives(samples, { sampleRate, ...(plosiveDetectionOptions || {}) })
    : { plosiveEvents: [] };
  const needsPeakDetection = !Array.isArray(peakEvents);
  const detectedPeaks = needsPeakDetection
    ? detectVocalPeaks(samples, { sampleRate, ...(peakDetectionOptions || {}) })
    : { peakEvents: [] };
  const resolvedBreaths = Array.isArray(breathEvents) ? breathEvents : detected.breathEvents;
  const resolvedSibilance = Array.isArray(sibilanceEvents) ? sibilanceEvents : detected.sibilanceEvents;
  const resolvedPlosives = Array.isArray(plosiveEvents) ? plosiveEvents : detectedPlosives.plosiveEvents;
  const resolvedPeaks = Array.isArray(peakEvents) ? peakEvents : detectedPeaks.peakEvents;
  const needsClickDetection = !Array.isArray(clickEvents);
  const detectedClicks = needsClickDetection
    ? detectVocalClicks(samples, {
        sampleRate,
        plosiveEvents: resolvedPlosives,
        peakEvents: resolvedPeaks,
        ...(clickDetectionOptions || {}),
      })
    : { clickEvents: [] };
  const resolvedClicks = Array.isArray(clickEvents) ? clickEvents : detectedClicks.clickEvents;
  const voice = analyzeVoice({
    pitchContour: pitch.pitchContour,
    breathEvents: resolvedBreaths,
    sibilanceEvents: resolvedSibilance,
    plosiveEvents: resolvedPlosives,
    peakEvents: resolvedPeaks,
    clickEvents: resolvedClicks,
    formants,
  });
  return {
    music: {
      bpm: tempo.bpm,
      bpmConfidence: tempo.confidence,
      beats: tempo.beats,
      tempoMap: tempo.tempoMap,
      noteEvents: pitch.noteEvents
    },
    voice: {
      ...voice,
      pitchContour: pitch.pitchContour,
      eventDetection: {
        source: needsBreathDetection || needsPlosiveDetection || needsPeakDetection || needsClickDetection ? 'local-heuristic-v1' : 'provided',
        breathCount: resolvedBreaths.length,
        sibilanceCount: resolvedSibilance.length,
        plosiveCount: resolvedPlosives.length,
        peakCount: resolvedPeaks.length,
        clickCount: resolvedClicks.length,
      }
    },
    confidence: {
      pitch: pitch.confidence,
      tempo: tempo.confidence,
      voice: voice.confidence
    }
  };
}

import { analyzePitch } from './pitch.mjs';
import { analyzeTempo } from './tempo.mjs';
import { analyzeVoice } from './voice.mjs';
import { detectBreathAndSibilance } from './breath-sibilance.mjs';

const DEFAULT_INTERACTIVE_PITCH_OPTIONS = Object.freeze({ hopSize: 2048 });

export function analyzeMusicalAudio({
  samples,
  sampleRate,
  onsets = [],
  breathEvents = null,
  sibilanceEvents = null,
  formants = [],
  durationSeconds = null,
  pitchOptions = DEFAULT_INTERACTIVE_PITCH_OPTIONS,
  breathDetectionOptions = undefined,
} = {}) {
  const pitch = analyzePitch(samples, sampleRate, pitchOptions);
  const tempo = analyzeTempo(onsets, { durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : (samples?.length && sampleRate ? samples.length / sampleRate : null) });
  const needsBreathDetection = !Array.isArray(breathEvents) || !Array.isArray(sibilanceEvents);
  const detected = needsBreathDetection
    ? detectBreathAndSibilance(samples, { sampleRate, ...(breathDetectionOptions || {}) })
    : { breathEvents: [], sibilanceEvents: [] };
  const resolvedBreaths = Array.isArray(breathEvents) ? breathEvents : detected.breathEvents;
  const resolvedSibilance = Array.isArray(sibilanceEvents) ? sibilanceEvents : detected.sibilanceEvents;
  const voice = analyzeVoice({ pitchContour: pitch.pitchContour, breathEvents: resolvedBreaths, sibilanceEvents: resolvedSibilance, formants });
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
        source: needsBreathDetection ? 'local-heuristic-v1' : 'provided',
        breathCount: resolvedBreaths.length,
        sibilanceCount: resolvedSibilance.length,
      }
    },
    confidence: {
      pitch: pitch.confidence,
      tempo: tempo.confidence,
      voice: voice.confidence
    }
  };
}

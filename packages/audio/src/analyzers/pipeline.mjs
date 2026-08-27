import { analyzePitch } from './pitch.mjs';
import { analyzeTempo } from './tempo.mjs';
import { analyzeVoice } from './voice.mjs';

const DEFAULT_INTERACTIVE_PITCH_OPTIONS = Object.freeze({ hopSize: 2048 });

export function analyzeMusicalAudio({ samples, sampleRate, onsets = [], breathEvents = [], sibilanceEvents = [], formants = [], durationSeconds = null, pitchOptions = DEFAULT_INTERACTIVE_PITCH_OPTIONS } = {}) {
  const pitch = analyzePitch(samples, sampleRate, pitchOptions);
  const tempo = analyzeTempo(onsets, { durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : (samples?.length && sampleRate ? samples.length / sampleRate : null) });
  const voice = analyzeVoice({ pitchContour: pitch.pitchContour, breathEvents, sibilanceEvents, formants });
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
      pitchContour: pitch.pitchContour
    },
    confidence: {
      pitch: pitch.confidence,
      tempo: tempo.confidence,
      voice: voice.confidence
    }
  };
}

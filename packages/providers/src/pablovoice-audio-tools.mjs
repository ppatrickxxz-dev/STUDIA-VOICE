import { confidenceDecision } from '../../audio/src/contracts/confidence.mjs';
import { planMixIntent } from '../../audio/src/mix/mix-intelligence-graph.mjs';
import { planBreathEdits } from '../../audio/src/voice/breath-intelligence.mjs';
import { analyzeAlignment } from '../../audio/src/voice/alignment-intelligence.mjs';
import { buildAudioToInstrumentPlan } from '../../audio/src/sampler/audio-to-instrument.mjs';

export const PABLOVOICE_AUDIO_TOOLS = Object.freeze([
  'inspect_audio',
  'inspect_mix',
  'bring_voice_forward',
  'make_vocal_space',
  'align_vocals',
  'soften_breaths',
  'audio_to_instrument',
]);

export function createPabloVoiceAudioToolRuntime({ getAnalysis, getMixState } = {}) {
  if (typeof getAnalysis !== 'function') throw new TypeError('getAnalysis is required');
  if (typeof getMixState !== 'function') throw new TypeError('getMixState is required');

  return async function executeAudioTool(name, args = {}) {
    if (!PABLOVOICE_AUDIO_TOOLS.includes(name)) throw new Error(`Unknown PabloVoice audio tool: ${name}`);

    if (name === 'inspect_audio') {
      const analysis = await getAnalysis(args.assetId);
      if (!analysis) return fail('analysis_not_found');
      return ok({
        assetId: analysis.assetId,
        music: analysis.music,
        signal: analysis.signal,
        voice: analysis.voice,
        validity: analysis.validity,
      });
    }

    if (name === 'inspect_mix') {
      const state = await getMixState(args.projectId);
      if (!state) return fail('mix_state_not_found');
      return ok(state);
    }

    if (name === 'bring_voice_forward' || name === 'make_vocal_space') {
      const state = await getMixState(args.projectId);
      if (!state) return fail('mix_state_not_found');
      const plan = planMixIntent(state, 'voice-forward', { targetTrackId: args.trackId || null });
      return guarded(plan, plan.confidence);
    }

    if (name === 'soften_breaths') {
      const analysis = await getAnalysis(args.assetId);
      if (!analysis) return fail('analysis_not_found');
      const edits = planBreathEdits(analysis, { mode: args.mode || 'soften' });
      const confidence = average(edits.map((event) => event.confidence));
      return guarded({ events: edits }, confidence);
    }

    if (name === 'align_vocals') {
      const reference = await getAnalysis(args.referenceAssetId);
      const target = await getAnalysis(args.targetAssetId);
      if (!reference || !target) return fail('analysis_not_found');
      const plan = analyzeAlignment(reference, target, { maxAutoOffsetMs: args.maxAutoOffsetMs || 120 });
      return guarded(plan, plan.confidence);
    }

    if (name === 'audio_to_instrument') {
      const analysis = await getAnalysis(args.assetId);
      if (!analysis) return fail('analysis_not_found');
      const plan = buildAudioToInstrumentPlan(analysis, {
        preserveFormants: args.preserveFormants !== false,
      });
      const confidence = plan.chromatic?.confidence ?? analysis.analysisV2?.confidence?.pitch ?? analysis.confidence?.pitch ?? 0;
      return guarded(plan, confidence);
    }
  };
}

function guarded(payload, confidence) {
  const decision = confidenceDecision(confidence);
  return ok({ ...payload, confidence, decision, execution: decision === 'auto' ? 'allowed' : 'preview_only' });
}

function ok(data) { return { ok: true, data }; }
function fail(reason) { return { ok: false, reason }; }
function average(values) {
  const xs = values.map(Number).filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

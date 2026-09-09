import { confidenceDecision } from '../../audio/src/contracts/confidence.mjs';
import { planMixIntent } from '../../audio/src/mix/mix-intelligence-graph.mjs';
import { planBreathEdits, summarizeBreathPlan } from '../../audio/src/voice/breath-intelligence.mjs';
import { analyzeAlignment } from '../../audio/src/voice/alignment-intelligence.mjs';
import { buildAudioToInstrumentPlan } from '../../audio/src/sampler/audio-to-instrument.mjs';
import {
  PROJECT_MUSIC_GRAPH_SCHEMA,
  resolveMusicGraphScope,
  validateMusicGraphAssets,
} from '../../music-intelligence/src/project-music-graph.mjs';

export const PABLOVOICE_AUDIO_TOOLS = Object.freeze([
  'inspect_audio',
  'inspect_mix',
  'bring_voice_forward',
  'make_vocal_space',
  'align_vocals',
  'soften_breaths',
  'audio_to_instrument',
]);

export function createPabloVoiceAudioToolRuntime({ getAnalysis, getMixState, getMusicGraph = null } = {}) {
  if (typeof getAnalysis !== 'function') throw new TypeError('getAnalysis is required');
  if (typeof getMixState !== 'function') throw new TypeError('getMixState is required');
  if (getMusicGraph != null && typeof getMusicGraph !== 'function') throw new TypeError('getMusicGraph must be a function');

  return async function executeAudioTool(name, args = {}) {
    if (!PABLOVOICE_AUDIO_TOOLS.includes(name)) throw new Error(`Unknown PabloVoice audio tool: ${name}`);

    const graph = getMusicGraph ? await getMusicGraph(args.projectId || null) : null;
    if (getMusicGraph && graph?.schema !== PROJECT_MUSIC_GRAPH_SCHEMA) return fail('music_graph_not_found');

    if (name === 'inspect_audio') {
      const binding = bindAssets(graph, [args.assetId]);
      if (!binding.ok) return binding;
      const analysis = await getAnalysis(args.assetId);
      if (!analysis) return fail('analysis_not_found');
      return ok(withGraphBinding({
        assetId: analysis.assetId,
        music: analysis.music,
        signal: analysis.signal,
        voice: analysis.voice,
        validity: analysis.validity,
      }, graph, { assetId: args.assetId }));
    }

    if (name === 'inspect_mix') {
      const state = await getMixState(args.projectId);
      if (!state) return fail('mix_state_not_found');
      return ok(withGraphBinding(state, graph));
    }

    if (name === 'bring_voice_forward' || name === 'make_vocal_space') {
      const state = await getMixState(args.projectId);
      if (!state) return fail('mix_state_not_found');
      const graphTrack = graph ? resolveGraphVocalTrack(graph, args.trackId) : null;
      if (graph && !graphTrack) return fail(args.trackId ? 'track_outside_music_graph' : 'vocal_track_missing_in_music_graph');
      const targetTrackId = graphTrack?.id || args.trackId || null;
      const plan = planMixIntent(state, 'voice-forward', { targetTrackId });
      return guarded(withGraphBinding(plan, graph, { trackId: targetTrackId }), plan.confidence);
    }

    if (name === 'soften_breaths') {
      const binding = bindAssets(graph, [args.assetId]);
      if (!binding.ok) return binding;
      const analysis = await getAnalysis(args.assetId);
      if (!analysis) return fail('analysis_not_found');
      const edits = planBreathEdits(analysis, { mode: args.mode || 'soften' });
      const summary = summarizeBreathPlan(edits);
      const confidence = average(edits.map((event) => event.confidence));
      return guarded(withGraphBinding({ events: edits, summary, total: summary.total }, graph, { assetId: args.assetId }), confidence);
    }

    if (name === 'align_vocals') {
      const binding = bindAssets(graph, [args.referenceAssetId, args.targetAssetId]);
      if (!binding.ok) return binding;
      const reference = await getAnalysis(args.referenceAssetId);
      const target = await getAnalysis(args.targetAssetId);
      if (!reference || !target) return fail('analysis_not_found');
      const plan = analyzeAlignment(reference, target, { maxAutoOffsetMs: args.maxAutoOffsetMs || 120 });
      return guarded(withGraphBinding(plan, graph, {
        referenceAssetId: args.referenceAssetId,
        targetAssetId: args.targetAssetId,
      }), plan.confidence);
    }

    if (name === 'audio_to_instrument') {
      const binding = bindAssets(graph, [args.assetId]);
      if (!binding.ok) return binding;
      const analysis = await getAnalysis(args.assetId);
      if (!analysis) return fail('analysis_not_found');
      const plan = buildAudioToInstrumentPlan(analysis, {
        preserveFormants: args.preserveFormants !== false,
      });
      const confidence = plan.chromatic?.confidence ?? analysis.analysisV2?.confidence?.pitch ?? analysis.confidence?.pitch ?? 0;
      return guarded(withGraphBinding(plan, graph, { assetId: args.assetId }), confidence);
    }
  };
}

function resolveGraphVocalTrack(graph, requestedTrackId = null) {
  if (!graph) return null;
  if (requestedTrackId) {
    const scoped = resolveMusicGraphScope(graph, { trackId: requestedTrackId });
    if (!scoped.track) return null;
    return isVocalRole(scoped.track.role) ? scoped.track : null;
  }
  return (graph.tracks || []).find((track) => isVocalRole(track.role) && track.active)
    || (graph.tracks || []).find((track) => track.role === 'lead-vocal')
    || (graph.tracks || []).find((track) => isVocalRole(track.role))
    || null;
}

function bindAssets(graph, assetIds) {
  if (!graph) return { ok: true };
  const validation = validateMusicGraphAssets(graph, assetIds);
  return validation.ok ? { ok: true } : fail(validation.reason || 'asset_outside_music_graph');
}

function withGraphBinding(payload, graph, scope = {}) {
  if (!graph) return payload;
  return {
    ...payload,
    musicGraph: Object.freeze({
      schema: graph.schema,
      projectId: graph.project?.id || null,
      trackId: scope.trackId || null,
      assetId: scope.assetId || null,
      referenceAssetId: scope.referenceAssetId || null,
      targetAssetId: scope.targetAssetId || null,
      preserveUnselected: true,
    }),
  };
}

function isVocalRole(role) {
  return ['lead-vocal', 'voice-variant', 'guide-vocal-target', 'stem-vocal', 'harmony-vocal'].includes(String(role || ''));
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

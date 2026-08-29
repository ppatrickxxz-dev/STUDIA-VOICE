import { getAudioAsset } from './storage.mjs';
import { encodePcmWav } from './instrument-engine.mjs';
import { normalizeSamplerState, samplerPadDuration } from './sampler-engine.mjs';
import { saveProjectWithAudioAsset } from './atomic-audio-project-storage.mjs';

export async function renderPabloBeatTimeline(project, plan = {}) {
  if (!project?.id) return blocked('project_required', 'Crie ou abra um projeto primeiro.');
  if (plan?.kind !== 'beat_fill_track' || !Array.isArray(plan?.events) || !plan.events.length) {
    return blocked('timeline_render_plan_required', 'A virada ainda não tem um plano de áudio válido. Não alterei o projeto.');
  }
  const duration = Number(plan.durationSeconds);
  const startSeconds = Number(plan.startSeconds);
  const endSeconds = Number(plan.endSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    return blocked('invalid_timeline_range', 'O intervalo da virada não é válido. Não alterei o projeto.');
  }

  const sampler = normalizeSamplerState(project.sampler || {});
  if (!sampler.pads.length) return blocked('sampler_required', 'Os samples do projeto não estão disponíveis para renderizar a virada.');
  const padById = new Map(sampler.pads.map((pad) => [pad.id, pad]));
  const usedPads = plan.events.map((event) => padById.get(event.padId)).filter(Boolean);
  if (!usedPads.length) return blocked('fill_samples_unavailable', 'A virada não encontrou os pads usados pelo Beat Lab. Não alterei o projeto.');

  const OfflineCtx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!OfflineCtx || !AudioCtx) return blocked('web_audio_unavailable', 'A renderização de áudio não está disponível neste aparelho. Não alterei o projeto.');

  const decodeContext = new AudioCtx();
  try {
    const decoded = await decodePadAssets(usedPads, decodeContext);
    const sampleRate = 48000;
    const frameCount = Math.max(1, Math.ceil(duration * sampleRate));
    const offline = new OfflineCtx(2, frameCount, sampleRate);
    const master = offline.createGain();
    master.gain.value = 0.82;
    master.connect(offline.destination);

    let scheduled = 0;
    for (const event of plan.events) {
      const pad = padById.get(event.padId);
      const buffer = pad ? decoded.get(pad.sourceAssetId) : null;
      if (!pad || !buffer) continue;
      const source = schedulePadClipped(offline, master, buffer, pad, Number(event.timeSeconds) || 0, Number(event.velocity || 104) / 127, duration);
      if (source) scheduled += 1;
    }
    if (!scheduled) return blocked('empty_render_schedule', 'Nenhum sample válido coube na janela da virada. Não alterei o projeto.');

    const renderedBuffer = await offline.startRendering();
    const rendered = {
      channels: Array.from({ length: renderedBuffer.numberOfChannels }, (_, channel) => renderedBuffer.getChannelData(channel)),
      sampleRate: renderedBuffer.sampleRate,
      frameCount: renderedBuffer.length,
      duration: renderedBuffer.duration,
    };
    const blob = encodePcmWav(rendered);
    const core = await loadCoreRuntime();
    if (!core) return blocked('project_runtime_unavailable', 'O runtime canônico do projeto não está disponível. Não alterei o projeto.');

    const assetId = core.createId('asset');
    const targetLabel = String(plan.targetSectionLabel || 'seção');
    const trackName = `Virada · ${targetLabel}`.slice(0, 120);
    const next = structuredClone(project);
    const priorTracks = (next.tracks || []).filter((track) => isSameTimelineTarget(track, plan));
    const staleAssetIds = priorTracks.map((track) => track.assetId).filter(Boolean);
    next.tracks = (next.tracks || []).filter((track) => !isSameTimelineTarget(track, plan));

    const track = core.createTrack({
      name: trackName,
      assetId,
      type: 'audio/wav',
      duration: rendered.duration,
      sampleRate: rendered.sampleRate,
      channels: rendered.channels.length,
      kind: 'beat-fill',
    });
    track.offset = startSeconds;
    track.trimEnd = rendered.duration;
    track.beatTimeline = {
      schema: 'pablovoice_beat_timeline_event_v1',
      operation: 'fill_before_section',
      generatedBy: 'pablo',
      targetSectionId: String(plan.targetSectionId || ''),
      targetSectionKind: String(plan.targetSectionKind || ''),
      targetSectionLabel: targetLabel,
      targetStartSeconds: endSeconds,
      startSeconds,
      endSeconds,
      bpm: Number(plan.bpm) || 120,
      intensity: clamp(Number(plan.intensity), 0, 1),
      category: plan.category ? String(plan.category) : null,
      sourcePadIds: [...new Set(plan.events.map((event) => String(event.padId || '')).filter(Boolean))],
    };
    next.tracks.push(track);
    if (!next.activeTrackId) next.activeTrackId = track.id;

    const snapped = core.snapshotProject(next, `Virada antes de ${targetLabel}`);
    const clean = core.migrateProject(snapped);
    const persisted = await saveProjectWithAudioAsset({
      project: clean,
      asset: { id: assetId, blob, name: `${trackName}.wav`, type: 'audio/wav' },
      deleteAssetIds: staleAssetIds,
    });

    return {
      ok: true,
      mutated: true,
      project: persisted.project,
      action: 'fill_before_section',
      reply: `Criei uma virada real antes de ${targetLabel} e posicionei a faixa para terminar em ${formatSeconds(endSeconds)}.`,
      data: {
        projectId: persisted.project.id,
        trackId: track.id,
        assetId,
        kind: track.kind,
        offset: track.offset,
        duration: rendered.duration,
        targetStartSeconds: endSeconds,
        replacedPriorFill: priorTracks.length > 0,
      },
    };
  } catch (error) {
    console.error('PABLO_BEAT_TIMELINE_RENDER_FAILED', error);
    return blocked('timeline_render_failed', 'Não consegui renderizar a virada com segurança. Mantive o projeto intacto.');
  } finally {
    try { await decodeContext.close?.(); } catch {}
  }
}

async function decodePadAssets(pads, context) {
  const ids = [...new Set(pads.map((pad) => pad.sourceAssetId).filter(Boolean))];
  const decoded = new Map();
  for (const id of ids) {
    const asset = await getAudioAsset(id);
    if (!asset?.blob) throw new Error(`Sample ausente: ${id}`);
    const bytes = await asset.blob.arrayBuffer();
    decoded.set(id, await context.decodeAudioData(bytes.slice(0)));
  }
  return decoded;
}

function schedulePadClipped(context, destination, buffer, pad, startTime, velocityScale, windowEnd) {
  const start = Math.max(0, Number(startTime) || 0);
  if (start >= windowEnd) return null;
  const padStart = Math.max(0, Number(pad.start) || 0);
  const available = Math.max(0, buffer.duration - padStart);
  const requestedSlice = Math.max(0, samplerPadDuration(pad));
  const rate = clamp(Number(pad.playbackRate) || 1, 0.25, 4);
  const maxMediaDuration = Math.max(0, (windowEnd - start) * rate);
  const sliceDuration = Math.min(available, requestedSlice, maxMediaDuration);
  if (!Number.isFinite(sliceDuration) || sliceDuration <= 0.005) return null;

  const audibleDuration = sliceDuration / rate;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(gain).connect(destination);
  const level = clamp((Number(pad.gain) || 1) * clamp(Number(velocityScale) || 1, 0.01, 1), 0.0001, 2);
  const fadeIn = Math.min(Number(pad.fadeIn) || 0, audibleDuration / 2);
  const fadeOut = Math.min(Number(pad.fadeOut) || 0, audibleDuration / 2);
  gain.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : level, start);
  if (fadeIn > 0) gain.gain.linearRampToValueAtTime(level, start + fadeIn);
  if (fadeOut > 0) {
    gain.gain.setValueAtTime(level, Math.max(start + fadeIn, start + audibleDuration - fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, start + audibleDuration);
  }
  source.start(start, padStart, sliceDuration);
  return source;
}

function isSameTimelineTarget(track, plan) {
  if (track?.kind !== 'beat-fill' || track?.beatTimeline?.operation !== 'fill_before_section') return false;
  const targetId = String(plan.targetSectionId || '');
  if (targetId) return String(track.beatTimeline.targetSectionId || '') === targetId;
  return track.beatTimeline.targetSectionKind === plan.targetSectionKind
    && Math.abs(Number(track.beatTimeline.targetStartSeconds || 0) - Number(plan.targetStartSeconds || 0)) <= 0.01;
}

async function loadCoreRuntime() {
  for (const specifier of ['./core/src/project.mjs', '../core/src/project.mjs']) {
    try {
      const module = await import(specifier);
      if (typeof module.createTrack === 'function' && typeof module.snapshotProject === 'function') return module;
    } catch {
      // Source tests and packaged runtime resolve the canonical core package from different roots.
    }
  }
  return null;
}

function formatSeconds(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  if (!minutes) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  const rendered = seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0');
  return `${minutes}:${rendered}`;
}

function blocked(reason, reply) {
  return { ok: false, mutated: false, reason, reply };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

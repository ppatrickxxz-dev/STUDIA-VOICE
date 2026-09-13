import { applyDirectedCandidate, directSongCandidates } from '../music-intelligence/src/index.mjs';
import { RemoteAuthAdapter } from './remote-auth.mjs';
import { createSongCreationPlan } from './song-creation-engine.mjs';
import { resolveNativeMusicResult, waitForNativeMusic } from './native-music-result-runtime.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DISPATCH_ENDPOINT = `${PROJECT_URL}/functions/v1/compute-kaggle-v58`;
export const NATIVE_MUSIC_GENERATION_SCHEMA = 'pablovoice_native_music_generation_v2';

function headers(token) {
  return { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}
function freshVariationSeed() {
  const values = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(values);
  const seeded = Number(values[0] || 0) & 0x7fffffff;
  return seeded || ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff) || 1;
}
async function readJson(response) {
  return response.json().catch(() => ({}));
}
function waitWithAbort(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(true), Math.max(0, Number(ms) || 0));
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}
function rememberedFingerprints(localProject, sessionFingerprints) {
  const persisted = (localProject?.songCreation?.takes || [])
    .map((take) => take?.pabloVoice2?.fingerprint || take?.director?.fingerprint || take?.render?.director?.fingerprint)
    .filter(Boolean)
    .map(String);
  return [...persisted, ...sessionFingerprints].slice(-24);
}
function compactDirector(direction) {
  const selected = direction?.selected;
  if (!selected) return null;
  return Object.freeze({
    schema: direction.schema,
    variation: direction.variation,
    fingerprint: selected.fingerprint,
    palette: selected.palette,
    variationMode: selected.variationMode,
    score: selected.score,
    groove: selected.groove,
    harmonicColor: selected.harmonicColor,
    texture: selected.texture,
    motif: selected.motif,
    energyCurve: selected.energyCurve,
  });
}
function cleanDirection(value, max = 430) {
  return String(value || '').replace(/```(?:json)?|```/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanLyrics(value, max = 12000) {
  return String(value || '')
    .replace(/```(?:text|markdown|md)?/gi, '')
    .replace(/```/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}
function lyricContext(plan) {
  const lines = Array.isArray(plan?.guideLines) ? plan.guideLines : [];
  return lines.map((line) => String(line?.text || '').trim()).filter(Boolean).join(' / ').slice(0, 2400);
}
function hasPlaceholderGuide(plan) {
  const values = (Array.isArray(plan?.guideLines) ? plan.guideLines : [])
    .map((line) => String(line?.text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim())
    .filter(Boolean);
  return values.length === 4 && values.join('|') === 'guia|melodica|para|cantar';
}
function lyricTask(plan, negativeStyles) {
  const avoid = (Array.isArray(negativeStyles) ? negativeStyles : []).filter(Boolean).slice(0, 10).join(', ');
  return [
    'Escreva uma letra ORIGINAL para esta música do PabloVoice.',
    'Retorne somente a letra, sem explicações e sem markdown de código.',
    'Use português brasileiro natural, cantável e autoral. Evite frases genéricas, rimas preguiçosas e repetição excessiva.',
    'Estruture com cabeçalhos [Verso 1], [Pré-Refrão], [Refrão], [Verso 2], [Ponte] e, se fizer sentido, [Pós-Refrão].',
    'Crie um refrão forte e memorável, versos que avancem a história e contraste real entre seções. Não copie artistas ou músicas existentes.',
    `Tema/direção: ${String(plan?.brief || '').trim()}`,
    `Gênero: ${plan?.genre || ''}; clima: ${plan?.mood || ''}; BPM: ${plan?.bpm || ''}; tom: ${plan?.key || ''} ${plan?.mode || ''}.`,
    avoid ? `Evitar na composição e no clima: ${avoid}.` : '',
  ].filter(Boolean).join('\n').slice(0, 5200);
}
function directionTask(plan, negativeStyles, instrumental) {
  const avoid = (Array.isArray(negativeStyles) ? negativeStyles : []).filter(Boolean).slice(0, 12).join(', ');
  return [
    'Atue como diretor musical do PabloVoice e converta o pedido abaixo em UMA direção de produção para o gerador de áudio.',
    'Retorne somente uma frase de no máximo 420 caracteres, sem introdução, sem markdown e sem escrever letra.',
    'Preserve exatamente a intenção do artista. Especifique groove, bateria, baixo, timbres, densidade, contraste entre verso/pré/refrão/ponte, clima e direção vocal quando houver voz.',
    'Não troque o gênero por um estilo genérico. Evite repetição de loop e peça transições/fills entre seções.',
    instrumental ? 'A saída será instrumental: não peça voz cantada.' : 'A saída será música completa com voz-guia coerente com a letra.',
    `Pedido do artista: ${String(plan?.brief || '').trim()}`,
    `Gênero: ${plan?.genre || ''}; clima: ${plan?.mood || ''}; BPM: ${plan?.bpm || ''}; tom: ${plan?.key || ''} ${plan?.mode || ''}.`,
    avoid ? `Evitar obrigatoriamente: ${avoid}.` : '',
  ].filter(Boolean).join('\n').slice(0, 5200);
}
async function remoteGeneratedLyrics({ auth, linkedProjectId, plan, negativeStyles, signal, onProgress }) {
  onProgress({ status: 'creative_lyrics', progress: 3, current_stage: 'song_brain_lyrics', human_message: 'Pablo IA está transformando o prompt em uma letra cantável' });
  const payload = {
    command: 'generate',
    project_id: linkedProjectId,
    task: lyricTask(plan, negativeStyles),
    context_pack: { purpose: 'full_song_lyrics_from_prompt', singer_profile: plan?.singerProfile || null },
    constraints: { original_only: true, section_headers: true, pt_br: true, review_before_apply: false },
    author_samples: [],
  };
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    last = await auth.agentTurn(payload, { signal, bypassGeneratorAdapter: true }).catch((error) => ({ ok: false, error: error?.message || 'creative_lyrics_failed' }));
    const text = cleanLyrics(last?.reply || last?.text);
    const lyricLines = text.split('\n').map((line) => line.trim()).filter((line) => line && !/^\[.*\]$/.test(line));
    if (last?.ok && text.length >= 80 && lyricLines.length >= 6) return Object.freeze({ ok: true, text, provider: last.provider || null, model: last.model || null });
    if (signal?.aborted) break;
  }
  return Object.freeze({ ok: false, error: last?.error || 'creative_lyrics_unavailable' });
}
function rebuildPlanWithLyrics(plan, lyrics) {
  return createSongCreationPlan({
    brief: plan.brief,
    lyrics,
    genre: plan.genre,
    mood: plan.mood,
    bpm: plan.bpm,
    durationSeconds: plan.durationSeconds,
    key: plan.key,
    mode: plan.mode,
    singerProfile: plan.singerProfile,
  });
}
async function remoteProductionDirection({ auth, linkedProjectId, plan, negativeStyles, instrumental, signal, onProgress }) {
  onProgress({ status: 'creative_direction', progress: 5, current_stage: 'song_brain', human_message: 'Pablo IA está entendendo o prompt e dirigindo a produção' });
  const payload = {
    command: 'generate',
    project_id: linkedProjectId,
    task: directionTask(plan, negativeStyles, instrumental),
    context_pack: {
      purpose: 'music_generation_direction',
      creation_mode: instrumental ? 'instrumental' : 'full_song',
      lyrics_excerpt: lyricContext(plan),
      sections: (plan?.sections || []).map((section) => ({ id: section.id, label: section.label, startBeat: section.startBeat, endBeat: section.endBeat })).slice(0, 16),
      singer_profile: instrumental ? null : plan?.singerProfile || null,
    },
    constraints: {
      max_direction_chars: 420,
      preserve_artist_request: true,
      no_lyrics_in_response: true,
      negative_styles: (Array.isArray(negativeStyles) ? negativeStyles : []).slice(0, 12),
    },
    author_samples: [],
  };
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    last = await auth.agentTurn(payload, { signal, bypassGeneratorAdapter: true }).catch((error) => ({ ok: false, error: error?.message || 'creative_direction_failed' }));
    const text = cleanDirection(last?.reply || last?.text);
    if (last?.ok && text) return Object.freeze({ ok: true, text, provider: last.provider || null, model: last.model || null });
    if (signal?.aborted) break;
  }
  return Object.freeze({ ok: false, error: last?.error || 'creative_direction_unavailable' });
}
function enrichPlanWithAiDirection(plan, aiDirection) {
  const text = cleanDirection(aiDirection?.text);
  if (!text) return plan;
  return Object.freeze({
    ...plan,
    brief: `AI production direction: ${text}. Artist request: ${String(plan.brief || '').trim()}`.slice(0, 1200),
    pabloVoiceAiDirection: text,
  });
}

export class NativeMusicGenerationClient {
  constructor({ authAdapter = null, fetchImpl = globalThis.fetch, endpoint = DISPATCH_ENDPOINT, pollIntervalMs = 5000 } = {}) {
    this.auth = authAdapter || new RemoteAuthAdapter({ fetchImpl });
    this.fetch = fetchImpl;
    this.endpoint = endpoint;
    this.pollIntervalMs = pollIntervalMs;
    this.recentFingerprints = [];
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
  }

  async generate({
    localProject,
    plan,
    negativeStyles = [],
    instrumental = false,
    signal,
    onProgress = () => {},
    variation = 0.72,
    locks = {},
  } = {}) {
    if (!localProject?.id) return { ok: false, error: 'local_project_required', fallback_allowed: false };
    if (!plan?.sections?.length || plan?.schema !== 'pablovoice_song_creation_v1') return { ok: false, error: 'music_plan_required', fallback_allowed: false };
    if (signal?.aborted) return { ok: false, error: 'request_cancelled', fallback_allowed: false };

    let linked = await this.auth.ensureRemoteProject(localProject);
    if (!linked?.ok || !linked?.project?.id) return { ok: false, error: linked?.error || 'project_link_failed', fallback_allowed: false };
    let session = await this.auth.ensureSession().catch(() => null);
    if (!session?.accessToken) return { ok: false, error: 'connection_required', fallback_allowed: false };

    let workingPlan = plan;
    let generatedLyrics = null;
    if (!instrumental && hasPlaceholderGuide(plan)) {
      const lyricsResult = await remoteGeneratedLyrics({ auth: this.auth, linkedProjectId: linked.project.id, plan, negativeStyles, signal, onProgress });
      if (!lyricsResult.ok) return { ok: false, error: 'creative_lyrics_unavailable', detail: lyricsResult.error || null, fallback_allowed: false };
      generatedLyrics = lyricsResult;
      workingPlan = rebuildPlanWithLyrics(plan, lyricsResult.text);
    }

    const aiDirection = await remoteProductionDirection({
      auth: this.auth,
      linkedProjectId: linked.project.id,
      plan: workingPlan,
      negativeStyles,
      instrumental,
      signal,
      onProgress,
    });
    if (!aiDirection.ok) {
      return { ok: false, error: 'creative_direction_unavailable', detail: aiDirection.error || null, generatedLyrics, fallback_allowed: false };
    }

    const directedInputPlan = enrichPlanWithAiDirection(workingPlan, aiDirection);
    const variationSeed = freshVariationSeed();
    const direction = directSongCandidates(directedInputPlan, {
      variation,
      candidateCount: 3,
      recentFingerprints: rememberedFingerprints(localProject, this.recentFingerprints),
      locks,
      entropy: variationSeed,
    });
    const directedPlan = applyDirectedCandidate(directedInputPlan, direction.selected);
    const director = compactDirector(direction);
    if (director?.fingerprint) this.recentFingerprints = [...this.recentFingerprints, director.fingerprint].slice(-12);

    const body = {
      project_id: linked.project.id,
      plan: directedPlan,
      negative_styles: Array.isArray(negativeStyles) ? negativeStyles.slice(0, 12) : [],
      instrumental: Boolean(instrumental),
      variation_seed: variationSeed,
      pablovoice_director: director,
      pablovoice_ai_direction: aiDirection,
      pablovoice_generated_lyrics: generatedLyrics ? { provider: generatedLyrics.provider, model: generatedLyrics.model } : null,
    };
    let projectRecoveryAttempts = 0;
    const relinkProject = async () => {
      const next = await this.auth.ensureRemoteProject(localProject).catch(() => null);
      if (!next?.ok || !next?.project?.id) return false;
      linked = next;
      body.project_id = next.project.id;
      return true;
    };
    const request = (payload = body) => this.fetch(this.endpoint, {
      method: 'POST',
      headers: headers(this.auth.session?.accessToken || session?.accessToken || ''),
      body: JSON.stringify(payload),
      signal,
    });
    const refreshSession = async () => {
      this.auth.clearSession({ keepDevice: true });
      session = await this.auth.ensureSession().catch(() => null);
      return Boolean(session?.accessToken);
    };

    onProgress({ status: 'dispatching', progress: 10, current_stage: 'gpu_dispatch', human_message: 'Direção pronta. Salvando a criação e buscando uma vaga na GPU' });
    let response = await request();
    if (response.status === 401 && !signal?.aborted) {
      if (!await refreshSession()) return { ok: false, error: 'connection_required', director, aiDirection, generatedLyrics, fallback_allowed: false };
      const relinked = await relinkProject();
      if (!relinked) return { ok: false, error: 'project_link_failed', director, aiDirection, generatedLyrics, fallback_allowed: false };
      response = await request();
    }
    let dispatch = await readJson(response);
    if (dispatch?.error === 'project_not_found' && response.status === 404 && !signal?.aborted && projectRecoveryAttempts < 1) {
      projectRecoveryAttempts += 1;
      const relinked = await relinkProject();
      if (!relinked) return { ok: false, error: 'project_link_failed', director, aiDirection, generatedLyrics, fallback_allowed: false };
      response = await request();
      dispatch = await readJson(response);
    }

    if (!response.ok || dispatch?.ok !== true || !dispatch?.job_id) {
      return {
        ok: false,
        error: dispatch?.error || `native_music_dispatch_${response.status}`,
        detail: dispatch?.detail || null,
        requestId: dispatch?.job_id || null,
        director,
        aiDirection,
        generatedLyrics,
        fallback_allowed: false,
      };
    }

    while (dispatch.status === 'queued_capacity') {
      if (signal?.aborted) return { ok: false, error: 'request_cancelled', requestId: dispatch.job_id, director, aiDirection, generatedLyrics, fallback_allowed: false };
      const retrySeconds = Math.max(5, Math.min(45, Number(dispatch?.retry_after_seconds) || 30));
      onProgress({ status: 'waiting_for_gpu', progress: 11, current_stage: 'gpu_capacity', human_message: 'Criação salva na fila. A GPU está terminando outra música; sua vez será retomada automaticamente.' });
      const waitMs = this.pollIntervalMs === 0 ? 0 : retrySeconds * 1000;
      const shouldContinue = await waitWithAbort(waitMs, signal);
      if (!shouldContinue) return { ok: false, error: 'request_cancelled', requestId: dispatch.job_id, director, aiDirection, generatedLyrics, fallback_allowed: false };

      response = await request({ resume_job_id: dispatch.job_id });
      if (response.status === 401 && !signal?.aborted) {
        if (!await refreshSession()) return { ok: false, error: 'connection_required', requestId: dispatch.job_id, director, aiDirection, generatedLyrics, fallback_allowed: false };
        response = await request({ resume_job_id: dispatch.job_id });
      }
      const resumed = await readJson(response);
      if (!response.ok || resumed?.ok !== true || !resumed?.job_id) {
        return {
          ok: false,
          error: resumed?.error || `native_music_resume_${response.status}`,
          detail: resumed?.detail || null,
          requestId: dispatch.job_id,
          director,
          aiDirection,
          generatedLyrics,
          fallback_allowed: false,
        };
      }
      dispatch = resumed;
    }

    try {
      onProgress({ status: dispatch.status || 'waiting_kaggle', progress: dispatch.progress || 15, current_stage: 'gpu_queued', human_message: 'PabloVoice está criando a música na GPU' });
      const job = await waitForNativeMusic({
        token: this.auth.session?.accessToken || session.accessToken,
        jobId: dispatch.job_id,
        fetchImpl: this.fetch,
        pollIntervalMs: this.pollIntervalMs,
        onProgress,
      });
      if (signal?.aborted) return { ok: false, error: 'request_cancelled', requestId: dispatch.job_id, director, aiDirection, generatedLyrics, fallback_allowed: false };
      const result = await resolveNativeMusicResult({ token: this.auth.session?.accessToken || session.accessToken, job, fetchImpl: this.fetch });
      return {
        ok: true,
        schema: NATIVE_MUSIC_GENERATION_SCHEMA,
        ...result,
        source: 'pablovoice_native_music_v2_3',
        songId: null,
        remoteProjectId: linked.project.id,
        director,
        aiDirection,
        generatedLyrics,
        directedPlan,
        fallback_allowed: false,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'native_music_failed', detail: error?.detail || null, requestId: dispatch.job_id, director, aiDirection, generatedLyrics, fallback_allowed: false };
    }
  }
}

export const NATIVE_MUSIC_ENDPOINTS = Object.freeze({ dispatch: DISPATCH_ENDPOINT });
export const PABLOVOICE_MUSIC_RUNTIME = Object.freeze({
  version: '2.3.0',
  directionEngine: 'pablovoice_ai_direction_plus_song_director_v2',
  primaryExecution: 'transparent_device_durable_capacity_queue_open_model_gpu',
  userLoginRequired: false,
  passwordPrompt: false,
  offlineMode: false,
  localDraft: 'disabled',
  fabricatedFallback: false,
  capacityQueue: 'durable_render_jobs',
});

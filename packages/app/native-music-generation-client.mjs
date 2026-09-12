import { applyDirectedCandidate, directSongCandidates } from '../music-intelligence/src/index.mjs';
import { RemoteAuthAdapter } from './remote-auth.mjs';
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

    const variationSeed = freshVariationSeed();
    const direction = directSongCandidates(plan, {
      variation,
      candidateCount: 3,
      recentFingerprints: rememberedFingerprints(localProject, this.recentFingerprints),
      locks,
      entropy: variationSeed,
    });
    const directedPlan = applyDirectedCandidate(plan, direction.selected);
    const director = compactDirector(direction);
    if (director?.fingerprint) this.recentFingerprints = [...this.recentFingerprints, director.fingerprint].slice(-12);

    const linked = await this.auth.ensureRemoteProject(localProject);
    if (!linked?.ok || !linked?.project?.id) return { ok: false, error: linked?.error || 'project_link_failed', fallback_allowed: false, director };
    let session = await this.auth.ensureSession().catch(() => null);
    if (!session?.accessToken) return { ok: false, error: 'connection_required', fallback_allowed: false, director };

    const body = {
      project_id: linked.project.id,
      plan: directedPlan,
      negative_styles: Array.isArray(negativeStyles) ? negativeStyles.slice(0, 12) : [],
      instrumental: Boolean(instrumental),
      variation_seed: variationSeed,
      pablovoice_director: director,
    };
    const request = () => this.fetch(this.endpoint, { method: 'POST', headers: headers(this.auth.session?.accessToken || session.accessToken), body: JSON.stringify(body), signal });
    let response = await request();
    if (response.status === 401 && !signal?.aborted) {
      this.auth.clearSession({ keepDevice: true });
      session = await this.auth.ensureSession().catch(() => null);
      if (session?.accessToken) response = await request();
    }
    const dispatch = await readJson(response);
    if (!response.ok || dispatch?.ok !== true || !dispatch?.job_id) {
      return {
        ok: false,
        error: dispatch?.error || `native_music_dispatch_${response.status}`,
        detail: dispatch?.detail || null,
        requestId: dispatch?.job_id || null,
        director,
        fallback_allowed: false,
      };
    }

    try {
      onProgress({ status: dispatch.status || 'waiting_kaggle', progress: dispatch.progress || 15, current_stage: 'gpu_queued', human_message: 'PabloVoice 2 está dirigindo e criando a música na GPU' });
      const job = await waitForNativeMusic({
        token: this.auth.session?.accessToken || session.accessToken,
        jobId: dispatch.job_id,
        fetchImpl: this.fetch,
        pollIntervalMs: this.pollIntervalMs,
        onProgress,
      });
      if (signal?.aborted) return { ok: false, error: 'request_cancelled', requestId: dispatch.job_id, director, fallback_allowed: false };
      const result = await resolveNativeMusicResult({ token: this.auth.session?.accessToken || session.accessToken, job, fetchImpl: this.fetch });
      return {
        ok: true,
        schema: NATIVE_MUSIC_GENERATION_SCHEMA,
        ...result,
        source: 'pablovoice_native_music_v2',
        songId: null,
        remoteProjectId: linked.project.id,
        director,
        directedPlan,
        fallback_allowed: false,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'native_music_failed', requestId: dispatch.job_id, director, fallback_allowed: false };
    }
  }
}

export const NATIVE_MUSIC_ENDPOINTS = Object.freeze({ dispatch: DISPATCH_ENDPOINT });
export const PABLOVOICE_MUSIC_RUNTIME = Object.freeze({
  version: '2.0.0',
  directionEngine: 'pablovoice_song_director_v2',
  primaryExecution: 'transparent_device_open_model_gpu',
  userLoginRequired: false,
  passwordPrompt: false,
  offlineMode: false,
  localDraft: 'disabled',
  fabricatedFallback: false,
});

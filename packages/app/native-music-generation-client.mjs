import { RemoteAuthAdapter } from './remote-auth.mjs';
import { resolveNativeMusicResult, waitForNativeMusic } from './native-music-result-runtime.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DISPATCH_ENDPOINT = `${PROJECT_URL}/functions/v1/compute-kaggle-v58`;
export const NATIVE_MUSIC_GENERATION_SCHEMA = 'pablovoice_native_music_generation_v1';

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

export class NativeMusicGenerationClient {
  constructor({ authAdapter = null, fetchImpl = globalThis.fetch, endpoint = DISPATCH_ENDPOINT, pollIntervalMs = 5000 } = {}) {
    this.auth = authAdapter || new RemoteAuthAdapter({ fetchImpl });
    this.fetch = fetchImpl;
    this.endpoint = endpoint;
    this.pollIntervalMs = pollIntervalMs;
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
  }

  async generate({ localProject, plan, negativeStyles = [], instrumental = false, signal, onProgress = () => {} } = {}) {
    if (!localProject?.id) return { ok: false, error: 'local_project_required', fallback_allowed: false };
    if (!plan?.sections?.length || plan?.schema !== 'pablovoice_song_creation_v1') return { ok: false, error: 'music_plan_required', fallback_allowed: false };
    if (signal?.aborted) return { ok: false, error: 'request_cancelled', fallback_allowed: false };

    const linked = await this.auth.ensureRemoteProject(localProject);
    if (!linked?.ok || !linked?.project?.id) return { ok: false, error: linked?.error || 'project_link_failed', fallback_allowed: false };
    let session = await this.auth.ensureSession().catch(() => null);
    if (!session?.accessToken) return { ok: false, error: 'auth_required', fallback_allowed: false };

    const body = {
      project_id: linked.project.id,
      plan,
      negative_styles: Array.isArray(negativeStyles) ? negativeStyles.slice(0, 12) : [],
      instrumental: Boolean(instrumental),
      variation_seed: freshVariationSeed(),
    };
    const request = () => this.fetch(this.endpoint, { method: 'POST', headers: headers(this.auth.session?.accessToken || session.accessToken), body: JSON.stringify(body), signal });
    let response = await request();
    if (response.status === 401 && !signal?.aborted) {
      this.auth.clearSession({ keepDevice: true });
      if (await this.auth.loginWithDevice()) {
        session = await this.auth.ensureSession();
        response = await request();
      }
    }
    const dispatch = await readJson(response);
    if (!response.ok || dispatch?.ok !== true || !dispatch?.job_id) {
      return {
        ok: false,
        error: dispatch?.error || `native_music_dispatch_${response.status}`,
        detail: dispatch?.detail || null,
        requestId: dispatch?.job_id || null,
        fallback_allowed: false,
      };
    }

    try {
      onProgress({ status: dispatch.status || 'waiting_kaggle', progress: dispatch.progress || 15, current_stage: 'gpu_queued', human_message: 'Criando a música na GPU' });
      const job = await waitForNativeMusic({
        token: this.auth.session?.accessToken || session.accessToken,
        jobId: dispatch.job_id,
        fetchImpl: this.fetch,
        pollIntervalMs: this.pollIntervalMs,
        onProgress,
      });
      if (signal?.aborted) return { ok: false, error: 'request_cancelled', requestId: dispatch.job_id, fallback_allowed: false };
      const result = await resolveNativeMusicResult({ token: this.auth.session?.accessToken || session.accessToken, job, fetchImpl: this.fetch });
      return {
        ok: true,
        schema: NATIVE_MUSIC_GENERATION_SCHEMA,
        ...result,
        source: 'pablovoice_native_music_v1',
        songId: null,
        remoteProjectId: linked.project.id,
        fallback_allowed: false,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'native_music_failed', requestId: dispatch.job_id, fallback_allowed: false };
    }
  }
}

export const NATIVE_MUSIC_ENDPOINTS = Object.freeze({ dispatch: DISPATCH_ENDPOINT });

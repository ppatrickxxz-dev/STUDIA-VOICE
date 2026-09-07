import { RemoteAuthAdapter } from './remote-auth.mjs';
import { resolveNativeMusicResult, waitForNativeMusic } from './native-music-result-runtime.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DISPATCH_ENDPOINT = `${PROJECT_URL}/functions/v1/compute-kaggle-v58`;
export const NATIVE_MUSIC_GENERATION_SCHEMA = 'pablovoice_native_music_generation_v1';
export const NATIVE_MUSIC_REPAINT_SCHEMA = 'pablovoice_native_music_repaint_v1';

function headers(token) {
  return { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
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
    return this.#dispatchAndResolve({
      localProject,
      expectedJobType: 'music_generation',
      schema: NATIVE_MUSIC_GENERATION_SCHEMA,
      source: 'pablovoice_native_music_v1',
      body: {
        action: 'generate',
        plan,
        negative_styles: Array.isArray(negativeStyles) ? negativeStyles.slice(0, 12) : [],
        instrumental: Boolean(instrumental),
      },
      signal,
      onProgress,
      initialMessage: 'Criando a música na GPU',
    });
  }

  async repaintSection({ localProject, sourceAssetId, durationMs, section, signal, onProgress = () => {} } = {}) {
    if (!localProject?.id) return { ok: false, error: 'local_project_required', fallback_allowed: false };
    if (!sourceAssetId) return { ok: false, error: 'source_asset_required', fallback_allowed: false };
    const startMs = Number(section?.startMs);
    const endMs = Number(section?.endMs);
    const totalMs = Number(durationMs);
    if (![startMs, endMs, totalMs].every(Number.isFinite) || startMs < 0 || endMs <= startMs || endMs > totalMs || totalMs <= 0) {
      return { ok: false, error: 'invalid_repaint_range', fallback_allowed: false };
    }
    return this.#dispatchAndResolve({
      localProject,
      expectedJobType: 'music_repaint',
      schema: NATIVE_MUSIC_REPAINT_SCHEMA,
      source: 'pablovoice_native_music_repaint_v1',
      body: {
        action: 'repaint',
        source_asset_id: sourceAssetId,
        duration_ms: Math.round(totalMs),
        section: {
          id: String(section?.id || '').slice(0, 120),
          label: String(section?.label || '').slice(0, 120),
          start_ms: Math.round(startMs),
          end_ms: Math.round(endMs),
          text: String(section?.text || '').slice(0, 12000),
          positive_styles: Array.isArray(section?.positiveStyles) ? section.positiveStyles.slice(0, 12) : [],
          negative_styles: Array.isArray(section?.negativeStyles) ? section.negativeStyles.slice(0, 12) : [],
        },
      },
      signal,
      onProgress,
      initialMessage: `Refazendo ${String(section?.label || 'a seção')} na GPU`,
    });
  }

  async #dispatchAndResolve({ localProject, expectedJobType, schema, source, body, signal, onProgress, initialMessage }) {
    if (signal?.aborted) return { ok: false, error: 'request_cancelled', fallback_allowed: false };
    const linked = await this.auth.ensureRemoteProject(localProject);
    if (!linked?.ok || !linked?.project?.id) return { ok: false, error: linked?.error || 'project_link_failed', fallback_allowed: false };
    let session = await this.auth.ensureSession().catch(() => null);
    if (!session?.accessToken) return { ok: false, error: 'auth_required', fallback_allowed: false };

    const payload = { project_id: linked.project.id, ...body };
    const request = () => this.fetch(this.endpoint, {
      method: 'POST',
      headers: headers(this.auth.session?.accessToken || session.accessToken),
      body: JSON.stringify(payload),
      signal,
    });
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
      onProgress({ status: dispatch.status || 'waiting_kaggle', progress: dispatch.progress || 15, current_stage: 'gpu_queued', human_message: initialMessage });
      const job = await waitForNativeMusic({
        token: this.auth.session?.accessToken || session.accessToken,
        jobId: dispatch.job_id,
        expectedJobType,
        fetchImpl: this.fetch,
        pollIntervalMs: this.pollIntervalMs,
        onProgress,
      });
      if (signal?.aborted) return { ok: false, error: 'request_cancelled', requestId: dispatch.job_id, fallback_allowed: false };
      const result = await resolveNativeMusicResult({ token: this.auth.session?.accessToken || session.accessToken, job, fetchImpl: this.fetch });
      return {
        ok: true,
        schema,
        ...result,
        source,
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

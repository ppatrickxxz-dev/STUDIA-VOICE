import { RemoteAuthAdapter } from './remote-auth.mjs';
import { resolveNativeMusicResult, waitForNativeMusic } from './native-music-result-runtime.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DISPATCH_ENDPOINT = `${PROJECT_URL}/functions/v1/compute-kaggle-v58`;
export const NATIVE_MUSIC_REPAINT_SCHEMA = 'pablovoice_native_music_repaint_v1';

function headers(token) {
  return { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}
async function readJson(response) { return response.json().catch(() => ({})); }

export class NativeMusicSectionRepaintClient {
  constructor({ authAdapter = null, fetchImpl = globalThis.fetch, endpoint = DISPATCH_ENDPOINT, pollIntervalMs = 5000 } = {}) {
    this.auth = authAdapter || new RemoteAuthAdapter({ fetchImpl });
    this.fetch = fetchImpl;
    this.endpoint = endpoint;
    this.pollIntervalMs = pollIntervalMs;
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
  }

  async repaintSection({ localProject, sourceAssetId, sourceTake, section, signal, onProgress = () => {} } = {}) {
    if (!localProject?.id) return { ok: false, error: 'local_project_required', fallback_allowed: false };
    if (!sourceAssetId) return { ok: false, error: 'source_asset_required', fallback_allowed: false };
    if (!section?.id || !Number.isFinite(Number(section.startMs)) || !Number.isFinite(Number(section.endMs)) || Number(section.endMs) <= Number(section.startMs)) {
      return { ok: false, error: 'invalid_repaint_range', fallback_allowed: false };
    }
    if (signal?.aborted) return { ok: false, error: 'request_cancelled', fallback_allowed: false };

    const linked = await this.auth.ensureRemoteProject(localProject);
    if (!linked?.ok || !linked?.project?.id) return { ok: false, error: linked?.error || 'project_link_failed', fallback_allowed: false };
    let session = await this.auth.ensureSession().catch(() => null);
    if (!session?.accessToken) return { ok: false, error: 'auth_required', fallback_allowed: false };

    const body = {
      operation: 'repaint',
      project_id: linked.project.id,
      source_asset_id: sourceAssetId,
      source_take: {
        brief: String(sourceTake?.brief || '').slice(0, 1200),
        genre: String(sourceTake?.genre || '').slice(0, 80),
        mood: String(sourceTake?.mood || '').slice(0, 160),
        bpm: Number(sourceTake?.bpm) || null,
        key: String(sourceTake?.key || '').slice(0, 8),
        mode: sourceTake?.mode === 'major' ? 'major' : 'minor',
        instrumental: sourceTake?.intelligence?.creationMode === 'instrumental_first',
      },
      section: {
        id: String(section.id).slice(0, 100),
        label: String(section.label || section.id).slice(0, 100),
        start_ms: Math.round(Number(section.startMs)),
        end_ms: Math.round(Number(section.endMs)),
        text: String(section.text || '').slice(0, 12000),
        positive_styles: Array.isArray(section.positiveStyles) ? section.positiveStyles.slice(0, 12) : [],
        negative_styles: Array.isArray(section.negativeStyles) ? section.negativeStyles.slice(0, 12) : [],
      },
    };
    const request = () => this.fetch(this.endpoint, {
      method: 'POST',
      headers: headers(this.auth.session?.accessToken || session.accessToken),
      body: JSON.stringify(body),
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
      return { ok: false, error: dispatch?.error || `native_repaint_dispatch_${response.status}`, detail: dispatch?.detail || null, requestId: dispatch?.job_id || null, fallback_allowed: false };
    }

    try {
      onProgress({ status: dispatch.status || 'waiting_kaggle', progress: dispatch.progress || 15, current_stage: 'gpu_queued', human_message: 'Refazendo somente a seção selecionada' });
      const job = await waitForNativeMusic({
        token: this.auth.session?.accessToken || session.accessToken,
        jobId: dispatch.job_id,
        expectedJobType: 'music_repaint',
        fetchImpl: this.fetch,
        pollIntervalMs: this.pollIntervalMs,
        onProgress,
      });
      if (signal?.aborted) return { ok: false, error: 'request_cancelled', requestId: dispatch.job_id, fallback_allowed: false };
      const result = await resolveNativeMusicResult({ token: this.auth.session?.accessToken || session.accessToken, job, fetchImpl: this.fetch });
      return {
        ok: true,
        schema: NATIVE_MUSIC_REPAINT_SCHEMA,
        ...result,
        source: 'pablovoice_native_music_repaint_v1',
        songId: null,
        remoteProjectId: linked.project.id,
        remoteAssetId: result.asset?.id || null,
        sourceAssetId,
        repaintRange: { startMs: Number(section.startMs), endMs: Number(section.endMs) },
        fallback_allowed: false,
      };
    } catch (error) {
      return { ok: false, error: error?.message || 'native_repaint_failed', requestId: dispatch.job_id, fallback_allowed: false };
    }
  }
}

export const NATIVE_MUSIC_REPAINT_ENDPOINTS = Object.freeze({ dispatch: DISPATCH_ENDPOINT });

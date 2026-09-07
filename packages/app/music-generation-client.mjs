import { RemoteAuthAdapter, REMOTE_ENDPOINTS } from './remote-auth.mjs';

export const HIGH_QUALITY_MUSIC_SCHEMA = 'pablovoice_high_quality_music_v1';

function musicGenerationUrl(agentUrl = REMOTE_ENDPOINTS.agent) {
  const value = String(agentUrl || '').trim();
  if (!value) return '';
  return value.replace(/\/api\/pablo-agent$/, '/api/music-generation');
}

export class MusicGenerationClient {
  constructor({ authAdapter = null, fetchImpl = globalThis.fetch, endpoint = musicGenerationUrl() } = {}) {
    this.auth = authAdapter || new RemoteAuthAdapter({ fetchImpl });
    this.fetch = fetchImpl;
    this.endpoint = endpoint;
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
  }

  async availability() {
    if (!this.endpoint) return { available: false, configured: false, authenticated: false, error: 'local_runtime' };
    try {
      const response = await this.fetch(this.endpoint, { method: 'GET' });
      const data = await response.json().catch(() => ({}));
      const session = await this.auth.ensureSession();
      return {
        available: Boolean(response.ok && data?.ok && data?.configured),
        configured: Boolean(data?.configured),
        authenticated: Boolean(session?.accessToken),
        provider: data?.provider || null,
        model: data?.model || null,
        sectionLockedPlan: Boolean(data?.section_locked_plan),
        inpaintingSourceId: Boolean(data?.inpainting_source_id),
        error: response.ok ? null : data?.error || `music_health_${response.status}`,
      };
    } catch {
      return { available: false, configured: false, authenticated: false, error: 'remote_unavailable' };
    }
  }

  async generate({ localProject, plan, negativeStyles = [], signal } = {}) {
    if (!this.endpoint) return { ok: false, error: 'remote_unavailable', fallback_allowed: true };
    if (!localProject?.id) return { ok: false, error: 'local_project_required', fallback_allowed: true };
    if (!plan?.sections?.length) return { ok: false, error: 'music_plan_required', fallback_allowed: false };

    const linked = await this.auth.ensureRemoteProject(localProject);
    if (!linked?.ok || !linked?.project?.id) {
      return { ok: false, error: linked?.error || 'project_link_failed', fallback_allowed: true };
    }
    const session = await this.auth.ensureSession();
    if (!session?.accessToken) return { ok: false, error: 'auth_required', fallback_allowed: true };

    const request = async () => this.fetch(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.auth.session?.accessToken || session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project_id: linked.project.id,
        plan,
        negative_styles: Array.isArray(negativeStyles) ? negativeStyles.slice(0, 12) : [],
      }),
      signal,
    });

    let response = await request();
    if (response.status === 401 && !signal?.aborted) {
      this.auth.clearSession({ keepDevice: true });
      if (await this.auth.loginWithDevice()) response = await request();
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        ok: false,
        error: data?.error || `music_generation_${response.status}`,
        detail: data?.detail || null,
        requestId: data?.request_id || null,
        fallback_allowed: true,
      };
    }

    const blob = await response.blob();
    if (!blob.size) return { ok: false, error: 'remote_empty_audio', fallback_allowed: true };
    return {
      ok: true,
      schema: HIGH_QUALITY_MUSIC_SCHEMA,
      blob,
      type: response.headers.get('content-type') || blob.type || 'audio/mpeg',
      provider: response.headers.get('x-pv-provider') || 'elevenmusic',
      model: response.headers.get('x-pv-model') || 'music_v2',
      songId: response.headers.get('x-pv-song-id') || null,
      requestId: response.headers.get('x-pv-request-id') || null,
      remoteProjectId: linked.project.id,
    };
  }
}

export function resolveMusicGenerationUrl(agentUrl = REMOTE_ENDPOINTS.agent) {
  return musicGenerationUrl(agentUrl);
}

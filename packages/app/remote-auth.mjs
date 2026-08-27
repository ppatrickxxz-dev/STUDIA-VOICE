const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const DEVICE_AUTH_URL = `${PROJECT_URL}/functions/v1/device-auth`;
const AGENT_URL = `${PROJECT_URL}/functions/v1/validate-app-js-v62`;
const SESSION_KEY = 'pablovoice.remote.session.v1';
const DEVICE_KEY = 'pablovoice.remote.device.v1';
const EXPIRY_SKEW_MS = 60_000;

function safeJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function decodeJwtPayload(token = '') {
  try {
    const payload = String(token).split('.')[1] || '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(normalized));
  } catch { return {}; }
}

function authHeaders(accessToken = '') {
  const headers = {
    apikey: PUBLISHABLE_KEY,
    'content-type': 'application/json',
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return headers;
}

function sessionFromPayload(payload = {}) {
  const accessToken = String(payload.access_token || '');
  const refreshToken = String(payload.refresh_token || '');
  if (!accessToken || !refreshToken) return null;
  const expiresIn = Math.max(30, Number(payload.expires_in || 3600));
  return {
    accessToken,
    refreshToken,
    tokenType: String(payload.token_type || 'bearer'),
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export class RemoteAuthAdapter {
  constructor({ storage = globalThis.localStorage, location = globalThis.location, fetchImpl = globalThis.fetch } = {}) {
    this.storage = storage;
    this.location = location;
    this.fetch = fetchImpl;
    this.session = safeJson(this.storage?.getItem?.(SESSION_KEY), null);
    this.deviceToken = String(this.storage?.getItem?.(DEVICE_KEY) || '');
    this.status = this.session ? 'session-cached' : 'local-only';
  }

  consumeBootstrapFragment() {
    const hash = String(this.location?.hash || '');
    if (!hash.includes('access_token=') && !hash.includes('device_token=')) return false;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const nextSession = sessionFromPayload(Object.fromEntries(params));
    const nextDeviceToken = String(params.get('device_token') || '');
    if (nextSession) this.setSession(nextSession);
    if (nextDeviceToken) this.setDeviceToken(nextDeviceToken);
    if (this.location?.history?.replaceState) this.location.history.replaceState(null, '', `${this.location.pathname || '/'}${this.location.search || ''}`);
    else if (globalThis.history?.replaceState) globalThis.history.replaceState(null, '', `${this.location?.pathname || '/'}${this.location?.search || ''}`);
    this.status = nextSession ? 'authenticated' : this.status;
    return Boolean(nextSession || nextDeviceToken);
  }

  setSession(session) {
    this.session = session;
    this.storage?.setItem?.(SESSION_KEY, JSON.stringify(session));
  }

  setDeviceToken(token) {
    this.deviceToken = String(token || '');
    if (this.deviceToken) this.storage?.setItem?.(DEVICE_KEY, this.deviceToken);
    else this.storage?.removeItem?.(DEVICE_KEY);
  }

  clearSession({ keepDevice = true } = {}) {
    this.session = null;
    this.storage?.removeItem?.(SESSION_KEY);
    if (!keepDevice) this.setDeviceToken('');
    this.status = 'local-only';
  }

  isSessionUsable() {
    return Boolean(this.session?.accessToken && Number(this.session?.expiresAt || 0) - EXPIRY_SKEW_MS > Date.now());
  }

  async refreshSession() {
    if (!this.session?.refreshToken) return null;
    try {
      const response = await this.fetch(`${PROJECT_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: this.session.refreshToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data?.error_description || data?.msg || `auth_refresh_${response.status}`));
      const next = sessionFromPayload(data);
      if (!next) throw new Error('auth_refresh_invalid');
      this.setSession(next);
      this.status = 'authenticated';
      return next;
    } catch {
      this.clearSession({ keepDevice: true });
      return null;
    }
  }

  async loginWithDevice() {
    if (!this.deviceToken) return null;
    try {
      const response = await this.fetch(DEVICE_AUTH_URL, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'login', device_token: this.deviceToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(String(data?.error || `device_login_${response.status}`));
      const next = sessionFromPayload(data.session || {});
      if (!next) throw new Error('device_login_invalid_session');
      this.setSession(next);
      if (data.device_token) this.setDeviceToken(data.device_token);
      this.status = 'authenticated';
      return next;
    } catch {
      this.clearSession({ keepDevice: false });
      return null;
    }
  }

  async ensureSession() {
    if (this.isSessionUsable()) return this.session;
    const refreshed = await this.refreshSession();
    if (refreshed) return refreshed;
    return this.loginWithDevice();
  }

  async ensureRemoteProject(localProject = {}) {
    const session = await this.ensureSession();
    const accessToken = session?.accessToken || '';
    const localId = String(localProject?.id || '').trim().slice(0, 160);
    const title = String(localProject?.name || localProject?.title || 'Projeto PabloVoice').trim().slice(0, 160) || 'Projeto PabloVoice';
    if (!accessToken) return { ok: false, error: 'auth_required', fallback_allowed: true };
    if (!localId) return { ok: false, error: 'local_project_id_required', fallback_allowed: true };
    const subject = String(decodeJwtPayload(accessToken)?.sub || '');
    if (!subject) return { ok: false, error: 'invalid_session', fallback_allowed: true };
    const filter = encodeURIComponent(JSON.stringify({ local_project_id: localId }));
    try {
      const lookup = await this.fetch(`${PROJECT_URL}/rest/v1/projects?select=id,title,metadata,updated_at&metadata=cs.${filter}&limit=1`, {
        headers: authHeaders(accessToken),
      });
      const matches = await lookup.json().catch(() => []);
      if (!lookup.ok) throw new Error(`project_lookup_${lookup.status}`);
      if (Array.isArray(matches) && matches[0]?.id) return { ok: true, created: false, project: matches[0] };
      const response = await this.fetch(`${PROJECT_URL}/rest/v1/projects?select=id,title,metadata,updated_at`, {
        method: 'POST',
        headers: { ...authHeaders(accessToken), prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: subject,
          title,
          metadata: { local_project_id: localId, source: 'pablovoice-local-first', linked_at: new Date().toISOString() },
        }),
      });
      const created = await response.json().catch(() => []);
      if (!response.ok || !Array.isArray(created) || !created[0]?.id) throw new Error(`project_create_${response.status}`);
      return { ok: true, created: true, project: created[0] };
    } catch {
      return { ok: false, error: 'project_link_failed', fallback_allowed: true };
    }
  }

  async agentHealth() {
    try {
      const response = await this.fetch(AGENT_URL, { headers: { apikey: PUBLISHABLE_KEY } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(`agent_health_${response.status}`);
      return { available: Boolean(data.configured), authenticated: Boolean(await this.ensureSession()), ...data };
    } catch {
      return { available: false, authenticated: false, fallback_allowed: true, error: 'remote_unavailable' };
    }
  }

  async agentTurn(payload) {
    const session = await this.ensureSession();
    if (!session?.accessToken) return { ok: false, error: 'auth_required', fallback_allowed: true };
    const request = async () => {
      const response = await this.fetch(AGENT_URL, {
        method: 'POST',
        headers: authHeaders(this.session?.accessToken || ''),
        body: JSON.stringify(payload),
      });
      return { response, data: await response.json().catch(() => ({})) };
    };
    let result = await request();
    if (result.response.status === 401) {
      this.clearSession({ keepDevice: true });
      if (await this.loginWithDevice()) result = await request();
    }
    if (!result.response.ok || !result.data?.ok) return { fallback_allowed: true, ...result.data, ok: false };
    return result.data;
  }
}

export const REMOTE_ENDPOINTS = Object.freeze({ project: PROJECT_URL, deviceAuth: DEVICE_AUTH_URL, agent: AGENT_URL });
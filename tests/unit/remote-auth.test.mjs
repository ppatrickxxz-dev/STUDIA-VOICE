import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAuthAdapter, resolveAgentUrl } from '../../packages/app/remote-auth.mjs';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('consumes bootstrap fragment and persists remote session without touching local project state', () => {
  const storage = new MemoryStorage();
  let replaced = '';
  const location = {
    hash: '#access_token=access-1&refresh_token=refresh-1&expires_in=3600&token_type=bearer&device_token=device-1234567890',
    pathname: '/assets/index.html',
    search: '?x=1',
  };
  const originalHistory = globalThis.history;
  globalThis.history = { replaceState(_a, _b, url) { replaced = url; } };
  try {
    const adapter = new RemoteAuthAdapter({ storage, location, fetchImpl: async () => { throw new Error('not-used'); } });
    assert.equal(adapter.consumeBootstrapFragment(), true);
    assert.equal(adapter.isSessionUsable(), true);
    assert.equal(adapter.deviceToken, 'device-1234567890');
    assert.equal(replaced, '/assets/index.html?x=1');
  } finally {
    globalThis.history = originalHistory;
  }
});

test('refreshes an expired transparent connection before remote use', async () => {
  const storage = new MemoryStorage();
  storage.setItem('pablovoice.remote.session.v1', JSON.stringify({ accessToken: 'old', refreshToken: 'refresh-old', expiresAt: 1 }));
  const calls = [];
  const adapter = new RemoteAuthAdapter({ storage, location: { hash: '' }, fetchImpl: async (url, options = {}) => {
    calls.push([url, options]);
    if (String(url).includes('/auth/v1/token')) return jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer' });
    throw new Error('unexpected');
  }});
  const session = await adapter.ensureSession();
  assert.equal(session.accessToken, 'new-access');
  assert.equal(adapter.status, 'connected');
  assert.equal(calls.length, 1);
});

test('rotates device token when transparent device reconnect succeeds', async () => {
  const storage = new MemoryStorage();
  storage.setItem('pablovoice.remote.device.v1', 'device-old-token-abcdefghijklmnopqrstuvwxyz0123456789');
  const adapter = new RemoteAuthAdapter({ storage, location: { hash: '' }, fetchImpl: async (url) => {
    assert.match(String(url), /device-auth$/);
    return jsonResponse(200, {
      ok: true,
      session: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer' },
      device_token: 'device-new-token-abcdefghijklmnopqrstuvwxyz0123456789',
    });
  }});
  const session = await adapter.ensureSession();
  assert.equal(session.accessToken, 'access');
  assert.match(adapter.deviceToken, /device-new-token/);
});

test('first use provisions a transparent device connection without user credentials', async () => {
  const storage = new MemoryStorage();
  const calls = [];
  const adapter = new RemoteAuthAdapter({ storage, location: { hash: '', origin: 'https://studia-voice.ppatrickxxz.workers.dev' }, fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body || '{}') });
    return jsonResponse(200, {
      ok: true,
      mode: 'transparent_device',
      session: { access_token: 'auto-access', refresh_token: 'auto-refresh', expires_in: 3600, token_type: 'bearer' },
      device_token: 'auto-device-token-abcdefghijklmnopqrstuvwxyz0123456789',
    });
  }});
  const session = await adapter.ensureSession();
  assert.equal(session.accessToken, 'auto-access');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /device-auth$/);
  assert.equal(calls[0].body.action, 'auto');
  assert.equal('email' in calls[0].body, false);
  assert.equal('password' in calls[0].body, false);
});

test('agent turn fails honestly without connection and never switches to a local/offline mode', async () => {
  const storage = new MemoryStorage();
  const adapter = new RemoteAuthAdapter({ storage, location: { hash: '' }, fetchImpl: async () => { throw new Error('offline'); } });
  const result = await adapter.agentTurn({ message: 'analise meu projeto' });
  assert.deepEqual(result, { ok: false, error: 'connection_required', fallback_allowed: false });
});

test('agent health remains non-fatal when remote service is unavailable', async () => {
  const adapter = new RemoteAuthAdapter({ storage: new MemoryStorage(), location: { hash: '' }, fetchImpl: async () => { throw new Error('offline'); } });
  const result = await adapter.agentHealth();
  assert.equal(result.available, false);
  assert.equal(result.fallback_allowed, false);
});

test('agent health targets canonical Cloudflare and may establish transparent access without a user prompt', async () => {
  const calls = [];
  const adapter = new RemoteAuthAdapter({
    storage: new MemoryStorage(),
    location: { hash: '', origin: 'https://studia-voice.ppatrickxxz.workers.dev' },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/api/pablo-agent')) return jsonResponse(200, { ok: true, configured: true, provider: 'cloudflare_workers_ai' });
      return jsonResponse(200, {
        ok: true,
        mode: 'transparent_device',
        session: { access_token: 'auto-access', refresh_token: 'auto-refresh', expires_in: 3600, token_type: 'bearer' },
        device_token: 'auto-device-token-abcdefghijklmnopqrstuvwxyz0123456789',
      });
    },
  });
  const result = await adapter.agentHealth();
  assert.equal(result.available, true);
  assert.equal(result.connected, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://studia-voice.ppatrickxxz.workers.dev/api/pablo-agent');
  assert.equal(calls[0].options.headers.apikey, 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH');
  assert.match(calls[1].url, /device-auth$/);
});

test('agent runtime selection uses the Worker preview, canonical Worker, or local fail-closed mode', () => {
  assert.equal(resolveAgentUrl({ origin: 'https://fix-cloudflare-composer-client-cutover-studia-voice.ppatrickxxz.workers.dev' }), 'https://fix-cloudflare-composer-client-cutover-studia-voice.ppatrickxxz.workers.dev/api/pablo-agent');
  assert.equal(resolveAgentUrl({ origin: 'https://studia-voice.ppatrickxxz.workers.dev' }), 'https://studia-voice.ppatrickxxz.workers.dev/api/pablo-agent');
  assert.equal(resolveAgentUrl({ origin: 'http://127.0.0.1:4173' }), '');
  assert.equal(resolveAgentUrl({ origin: 'http://localhost:4173' }), '');
});

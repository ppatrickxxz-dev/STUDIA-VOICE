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

test('refreshes an expired session before remote use', async () => {
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
  assert.equal(adapter.status, 'authenticated');
  assert.equal(calls.length, 1);
});

test('rotates device token when device login succeeds', async () => {
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

test('agent turn degrades honestly to local fallback without auth', async () => {
  const storage = new MemoryStorage();
  const adapter = new RemoteAuthAdapter({ storage, location: { hash: '' }, fetchImpl: async () => { throw new Error('network should not be required'); } });
  const result = await adapter.agentTurn({ message: 'analise meu projeto' });
  assert.deepEqual(result, { ok: false, error: 'auth_required', fallback_allowed: true });
});

test('agent health remains non-fatal when remote service is unavailable', async () => {
  const adapter = new RemoteAuthAdapter({ storage: new MemoryStorage(), location: { hash: '' }, fetchImpl: async () => { throw new Error('offline'); } });
  const result = await adapter.agentHealth();
  assert.equal(result.available, false);
  assert.equal(result.fallback_allowed, true);
});

test('agent health targets the canonical Cloudflare Composer runtime', async () => {
  const calls = [];
  const adapter = new RemoteAuthAdapter({
    storage: new MemoryStorage(),
    location: { hash: '' },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, { ok: true, configured: true, provider: 'cloudflare_workers_ai' });
    },
  });
  const result = await adapter.agentHealth();
  assert.equal(result.available, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://studia-voice.ppatrickxxz.workers.dev/api/pablo-agent');
  assert.equal(calls[0].options.headers.apikey, 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH');
});

  
test('agent runtime selection uses the Worker preview, canonical Worker, or local fail-closed mode', () => {
  assert.equal(resolveAgentUrl({ origin: 'https://fix-cloudflare-composer-client-cutover-studia-voice.ppatrickxxz.workers.dev' }), 'https://fix-cloudflare-composer-client-cutover-studia-voice.ppatrickxxz.workers.dev/api/pablo-agent');
  assert.equal(resolveAgentUrl({ origin: 'https://studia-voice.ppatrickxxz.workers.dev' }), 'https://studia-voice.ppatrickxxz.workers.dev/api/pablo-agent');
  assert.equal(resolveAgentUrl({ origin: 'http://127.0.0.1:4173' }), '');
  assert.equal(resolveAgentUrl({ origin: 'http://localhost:4173' }), '');
});

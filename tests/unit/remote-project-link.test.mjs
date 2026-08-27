import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAuthAdapter } from '../../packages/app/remote-auth.mjs';

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(sub = '11111111-1111-1111-1111-111111111111') {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub })}.x`;
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function session(accessToken = token()) {
  return { accessToken, refreshToken: 'refresh', expiresAt: Date.now() + 3600_000, tokenType: 'bearer' };
}

test('ensureRemoteProject reuses an existing project linked by metadata', async () => {
  const calls = [];
  const adapter = new RemoteAuthAdapter({
    storage: memoryStorage({ 'pablovoice.remote.session.v1': JSON.stringify(session()) }),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify([{ id: '22222222-2222-2222-2222-222222222222', title: 'Minha ideia', metadata: { local_project_id: 'project-local-1' } }]), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await adapter.ensureRemoteProject({ id: 'project-local-1', name: 'Minha ideia' });
  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.project.id, '22222222-2222-2222-2222-222222222222');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rest\/v1\/projects/);
  assert.match(calls[0].url, /metadata=cs\./);
});

test('ensureRemoteProject creates only metadata identity when no remote link exists', async () => {
  const calls = [];
  const adapter = new RemoteAuthAdapter({
    storage: memoryStorage({ 'pablovoice.remote.session.v1': JSON.stringify(session()) }),
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify([{ id: '33333333-3333-3333-3333-333333333333', title: 'Voz 1', metadata: { local_project_id: 'local-2' } }]), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await adapter.ensureRemoteProject({ id: 'local-2', name: 'Voz 1' });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.user_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(body.title, 'Voz 1');
  assert.equal(body.metadata.local_project_id, 'local-2');
  assert.equal(body.metadata.source, 'pablovoice-local-first');
  assert.equal('audio' in body, false);
});

test('ensureRemoteProject remains local-first without a remote session', async () => {
  const adapter = new RemoteAuthAdapter({ storage: memoryStorage(), fetchImpl: async () => { throw new Error('should not fetch'); } });
  const result = await adapter.ensureRemoteProject({ id: 'local-only', name: 'Offline' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'auth_required');
  assert.equal(result.fallback_allowed, true);
});

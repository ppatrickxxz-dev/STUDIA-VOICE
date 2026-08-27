import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preboot = await readFile(new URL('../../packages/app/preboot.mjs', import.meta.url), 'utf8');
const remote = await readFile(new URL('../../packages/app/pablo-remote.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../../packages/app/index.html', import.meta.url), 'utf8');

test('Pablo remote layer is optional and local app boots first', () => {
  assert.match(preboot, /await import\('\.\/app\.js'\)/);
  assert.match(preboot, /import\('\.\/pablo-remote\.mjs'\)\.catch/);
});

test('Pablo remote turn is advice-only and has local fallback', () => {
  assert.match(remote, /ensureRemoteProject\(project\)/);
  assert.match(remote, /agentTurn\(/);
  assert.match(remote, /destructive_actions:\s*false/);
  assert.match(remote, /tools:\s*\[\]/);
  assert.match(remote, /sugestões locais continuam ativas/);
});

test('Pablo follows the project explicitly opened by the user', () => {
  assert.match(remote, /activeLocalProjectId/);
  assert.match(remote, /\[data-action="open-project"\]\[data-id\]/);
  assert.match(remote, /projects\.find\(\(project\) => project\.id === remoteState\.activeLocalProjectId\)/);
});

test('CSP only adds the canonical Supabase project origin', () => {
  assert.match(html, /connect-src 'self' https:\/\/yokmhqoncdwvxmzzybqa\.supabase\.co/);
});

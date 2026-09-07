import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../packages/app/stems-canary.mjs', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../packages/app/index.html', import.meta.url), 'utf8');

test('connected stems consumes auth fragment before its product entrypoint can run', () => {
  assert.match(source, /auth\.consumeBootstrapFragment\(\);/);
  const initIndex = source.indexOf('auth.consumeBootstrapFragment();');
  const runIndex = source.indexOf('export async function runStemsSeparation');
  assert.ok(initIndex >= 0 && runIndex > initIndex);
});

test('connected stems fails closed instead of blindly using projects[0]', () => {
  assert.doesNotMatch(source, /const\s+project\s*=\s*projects\[0\]/);
  assert.match(source, /resolveVisibleProject/);
  assert.match(source, /mais de um projeto compatível/);
  assert.match(source, /Não foi possível identificar com segurança/);
});

test('remembered project is accepted only when it matches visible Studio candidates', () => {
  assert.match(source, /const\s+candidates\s*=\s*projects\.filter[\s\S]*const\s+remembered\s*=\s*localStorage\.getItem[\s\S]*candidates\.find\(\(project\)\s*=>\s*project\.id\s*===\s*remembered\)/);
  assert.doesNotMatch(source, /getProject\(remembered\)/);
  assert.match(source, /localStorage\.removeItem\(ACTIVE_PROJECT_KEY\)/);
});

test('opening a project captures the visible project identity before dispatch', () => {
  assert.match(source, /data-action=\"open-project\"/);
  assert.match(source, /ACTIVE_PROJECT_KEY/);
  assert.match(source, /localProjectId:\s*project\.id/);
});

test('connected stems keeps strict CSP and only uses the canonical Supabase origin', () => {
  assert.match(html, /connect-src 'self' https:\/\/yokmhqoncdwvxmzzybqa\.supabase\.co/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.doesNotMatch(source, /service_role/i);
});

test('persisted standalone route evidence remains distinct from B09 acoustic promotion', () => {
  assert.match(source, /routeValidated:\s*true/);
  assert.match(source, /b09AcousticValidated:\s*false/);
  assert.match(source, /compute-kaggle-v54/);
  assert.match(source, /recording-ticket-v63/);
  assert.match(source, /recording-finalize-v63/);
  assert.doesNotMatch(source, /B09_STANDALONE_STEMS_PASSED/);
});

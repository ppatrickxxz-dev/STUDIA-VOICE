import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../../packages/app/stems-canary.mjs',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../packages/app/index.html',import.meta.url),'utf8');

test('stems canary consumes auth fragment during module initialization',()=>{
  assert.match(source,/auth\.consumeBootstrapFragment\(\);/);
  const initIndex=source.indexOf('auth.consumeBootstrapFragment();');
  const runIndex=source.indexOf('async function runCanary');
  assert.ok(initIndex>=0 && initIndex<runIndex);
});

test('stems canary fails closed instead of blindly using projects[0]',()=>{
  assert.doesNotMatch(source,/const project=projects\[0\]/);
  assert.match(source,/resolveVisibleProject/);
  assert.match(source,/mais de um projeto compatível/);
  assert.match(source,/Não foi possível identificar com segurança/);
});

test('opening a project captures the visible project identity before dispatch',()=>{
  assert.match(source,/data-action=\"open-project\"/);
  assert.match(source,/ACTIVE_PROJECT_KEY/);
  assert.match(source,/localProjectId:project\.id/);
});

test('candidate keeps strict CSP and only adds canonical Supabase connect origin',()=>{
  assert.match(html,/connect-src 'self' https:\/\/yokmhqoncdwvxmzzybqa\.supabase\.co/);
  assert.doesNotMatch(html,/unsafe-inline/);
  assert.doesNotMatch(source,/service_role/i);
});

test('route remains candidate until persisted standalone evidence exists',()=>{
  assert.match(source,/routeValidated:false/);
  assert.match(source,/compute-kaggle-v54/);
  assert.match(source,/recording-ticket-v63/);
  assert.match(source,/recording-finalize-v63/);
});

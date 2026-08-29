import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/web-functional-gate.yml', import.meta.url), 'utf8');
const spec = await readFile(new URL('../e2e/site-vivo-functional-gate.spec.mjs', import.meta.url), 'utf8');

test('canonical Web Functional Gate runs the Site Vivo spec exactly once', () => {
  const refs = workflow.match(/tests\/e2e\/site-vivo-functional-gate\.spec\.mjs/g) || [];
  assert.equal(refs.length, 1);
});

test('Site Vivo gate proves route, canonical assets, module reaction and Studio CTA', () => {
  assert.match(spec, /page\.goto\('\/site\/'/);
  assert.match(spec, /Abrir o Studio/);
  assert.match(spec, /#hero-screen-img/);
  assert.match(spec, /Pablo canônico/);
  assert.match(spec, /Painel dos companions/);
  assert.match(spec, /Modo Voice Lab/);
  assert.match(spec, /Modo Beat Lab/);
});

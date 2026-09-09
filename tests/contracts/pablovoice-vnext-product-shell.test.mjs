import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../../packages/app/index.html', import.meta.url), 'utf8');
const boot = await readFile(new URL('../../packages/app/pablovoice-vnext-bootstrap.mjs', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../packages/app/pablovoice-vnext-ui.mjs', import.meta.url), 'utf8');
const routeCompat = await readFile(new URL('../../packages/app/pablovoice-vnext-route-compat.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../../packages/app/pablovoice-vnext-ui.css', import.meta.url), 'utf8');
const unifiedCss = await readFile(new URL('../../packages/app/pablovoice-vnext-unified.css', import.meta.url), 'utf8');
const sw = await readFile(new URL('../../packages/app/service-worker.js', import.meta.url), 'utf8');

test('vNext is an additive surface over the proven unified core boot', () => {
  assert.match(index, /creator-unified-runtime\.mjs/);
  assert.match(index, /pablovoice-vnext-bootstrap\.mjs/);
  assert.match(boot, /installPabloVoiceVNextUI/);
  assert.match(boot, /installPabloVoiceVNextRouteCompat/);
  assert.match(boot, /coreBootIndependent:\s*true/);
  assert.match(boot, /studioMode:\s*'unified'/);
  assert.match(index, /pablovoice-vnext-ui\.css/);
  assert.match(index, /pablovoice-vnext-compat\.css/);
  assert.match(index, /pablovoice-vnext-unified\.css/);
  for (const asset of ['pablovoice-vnext-bootstrap.mjs','pablovoice-vnext-ui.mjs','pablovoice-vnext-route-compat.mjs','pablovoice-companion-reactor.mjs']) assert.ok(sw.includes(asset));
});

test('vNext remains the single visible route surface and delegates real product actions', () => {
  assert.match(routeCompat, /nav\.classList\.add\('pv-nav'\)/);
  assert.match(routeCompat, /ensureCanonicalRoute\(nav, 'studio'/);
  assert.match(routeCompat, /ensureCanonicalRoute\(nav, 'projects'/);
  assert.match(routeCompat, /legacy\.classList\.remove\('pv-nav'\)/);
  for (const hook of ['data-beat-lab-open','data-instrument-open','data-action="studio-tab"','data-section-map-open','data-pv-studio-stems','data-action="record"','data-action="play"']) assert.ok(ui.includes(hook), `missing hook ${hook}`);
});

test('vNext uses the unified Music Graph and canonical character sources', () => {
  assert.match(ui, /buildUnifiedProjectContext/);
  assert.match(ui, /runtime\.graph/);
  assert.match(ui, /\/site\/assets\/pablo_fullbody\.webp/);
  assert.match(css, /\/site\/assets\/companions_board\.webp/);
  for (const name of ['Nota Drop','Wave Ribbon','Chime Lantern','EQ Bloom','Vinyl Groove','Star Spark']) assert.ok(ui.includes(name));
});

test('connectivity never appears as a second vNext product mode', () => {
  assert.match(routeCompat, /unifiedConnectivityLanguage:\s*true/);
  assert.match(routeCompat, /node\.textContent = 'STUDIO'/);
  assert.match(unifiedCss, /data-vnext-network/);
  assert.match(unifiedCss, /visibility:hidden/);
});

test('vNext observer ignores text-only feedback so Android import/Open-With remains responsive', () => {
  assert.match(boot, /isElementStructuralMutation/);
  assert.match(boot, /node\.nodeType === Node\.ELEMENT_NODE/);
  assert.match(boot, /structuralObserver:\s*true/);
  assert.match(boot, /ignoresTextOnlyObserverFeedback:\s*true/);
  assert.match(boot, /androidImportBridgeResponsive:\s*true/);
});

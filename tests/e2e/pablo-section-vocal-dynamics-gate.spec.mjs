import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.6, sampleRate = 44100, frequency = 330 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 1800, (samples - index) / 1800);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.18 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

async function sendPablo(page, message) {
  const form = page.locator('[data-pablo-form]');
  await form.locator('input[name="message"]').fill(message);
  await form.getByRole('button', { name: 'Enviar' }).click();
}

async function seedProject(page) {
  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const core = await import('./core/src/project.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks[0];
    vocal.kind = 'recording'; vocal.name = 'Voz principal';
    const support = core.createTrack({ name: 'Instrumental', assetId: vocal.assetId, type: vocal.type, duration: vocal.duration, sampleRate: vocal.sampleRate, channels: vocal.channels, kind: 'audio' });
    project.tracks.push(support); project.activeTrackId = support.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 0.3, endSeconds: 0.95, source: 'user_manual', confidence: 1 });
    await storage.saveProject(project);
  });
}

async function installCompressorEvidence(page) {
  await page.evaluate(() => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context?.prototype) throw new Error('AudioContext indisponível no gate.');
    if (!Context.prototype.__pvOriginalCreateDynamicsCompressor) {
      Context.prototype.__pvOriginalCreateDynamicsCompressor = Context.prototype.createDynamicsCompressor;
      Context.prototype.createDynamicsCompressor = function patchedCreateDynamicsCompressor(...args) {
        const node = Context.prototype.__pvOriginalCreateDynamicsCompressor.apply(this, args);
        globalThis.__pvCompressorEvidence = globalThis.__pvCompressorEvidence || [];
        globalThis.__pvCompressorEvidence.push(node);
        return node;
      };
    }
    globalThis.__pvCompressorEvidence = [];
  });
}
async function resetCompressorEvidence(page) { await page.evaluate(() => { globalThis.__pvCompressorEvidence = []; }); }
async function compressorEvidence(page) {
  return page.evaluate(() => (globalThis.__pvCompressorEvidence || []).map((node) => ({
    thresholdDb: Number(node.threshold?.value || 0), ratio: Number(node.ratio?.value || 0),
    kneeDb: Number(node.knee?.value || 0), attackSeconds: Number(node.attack?.value || 0), releaseSeconds: Number(node.release?.value || 0),
  })));
}

test('WEB VOCAL DYNAMICS GATE: real compressor is regional, A/B isolated and selectively undoable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate dinâmica vocal regional');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'dynamics.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('dynamics.wav').first()).toBeVisible();
  await seedProject(page);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'comprime minha voz 8:1 no refrão');
  await expect(page.getByText(/só aplico automaticamente entre 1,2:1 e 4:1/i).last()).toBeVisible();

  await sendPablo(page, 'segura os picos da minha voz só no refrão');
  await expect(page.getByText(/compressão 2\.2:1 com entrada em -18 dB/i).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Studio · dinâmica regional salva/i).last()).toBeVisible();

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    const event = vocal.regionAutomation.find((item) => item.source === 'pablo_section_vocal_dynamics');
    vocal.regionAutomation.push({
      id: `manual_compressor:${project.arrangementMap.sections[0].id}`, kind: 'compressor', startSeconds: 0.3, endSeconds: 0.95,
      thresholdDb: -12, ratio: 1.5, kneeDb: 4, attackSeconds: 0.01, releaseSeconds: 0.15,
      confidence: 1, source: 'user_manual', enabled: true,
    });
    await storage.saveProject(project);
    return { schemaVersion: project.schemaVersion, event, supportCount: support.regionAutomation.length };
  });
  expect(saved.schemaVersion).toBe(9);
  expect(saved.event.kind).toBe('compressor');
  expect(saved.event.thresholdDb).toBe(-18); expect(saved.event.ratio).toBe(2.2);
  expect(saved.event.attackSeconds).toBe(0.006); expect(saved.event.releaseSeconds).toBe(0.12);
  expect(saved.supportCount).toBe(0);

  await sendPablo(page, 'controla a dinâmica da minha voz no refrão');
  const repeatedCount = await page.evaluate(async () => {
    const storage = await import('./storage.mjs'); const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.filter((event) => event.source === 'pablo_section_vocal_dynamics').length;
  });
  expect(repeatedCount).toBe(1);

  await installCompressorEvidence(page);
  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last(); await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Ouvir A' }).click(); await page.waitForTimeout(140);
  const a = await compressorEvidence(page);
  expect(a.some((item) => Math.abs(item.ratio - 1.5) < 0.08 && item.thresholdDb < -10)).toBe(true);
  expect(a.some((item) => Math.abs(item.ratio - 2.2) < 0.08 && item.thresholdDb < -16)).toBe(false);
  const persistedAfterA = await page.evaluate(async () => {
    const storage = await import('./storage.mjs'); const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.map((event) => event.source).sort();
  });
  expect(persistedAfterA).toEqual(['pablo_section_vocal_dynamics', 'user_manual']);

  await resetCompressorEvidence(page);
  await panel.getByRole('button', { name: 'Ouvir B' }).click(); await page.waitForTimeout(140);
  const b = await compressorEvidence(page);
  expect(b.some((item) => Math.abs(item.ratio - 1.5) < 0.08 && item.thresholdDb < -10)).toBe(true);
  expect(b.some((item) => Math.abs(item.ratio - 2.2) < 0.08 && item.thresholdDb < -16)).toBe(true);

  await sendPablo(page, 'desfaz a dinâmica da minha voz no refrão');
  await expect(page.getByText(/Desfiz a dinâmica vocal que eu tinha criado no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs'); const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.map((event) => ({ source: event.source, kind: event.kind, ratio: event.ratio, thresholdDb: event.thresholdDb }));
  });
  expect(afterUndo).toEqual([{ source: 'user_manual', kind: 'compressor', ratio: 1.5, thresholdDb: -12 }]);

  await sendPablo(page, 'compara o refrão');
  await expect(page.getByText(/Não há ajustes regionais meus nesse refrão para fazer A\/B/i).last()).toBeVisible();

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.6, sampleRate = 44100, frequency = 220 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
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
    vocal.kind = 'recording';
    vocal.name = 'Voz principal';
    const support = core.createTrack({
      name: 'Instrumental', assetId: vocal.assetId, type: vocal.type,
      duration: vocal.duration, sampleRate: vocal.sampleRate, channels: vocal.channels, kind: 'audio',
    });
    project.tracks.push(support);
    project.activeTrackId = support.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus', startSeconds: 0.3, endSeconds: 0.95, source: 'user_manual', confidence: 1,
    });
    await storage.saveProject(project);
  });
}

async function installFilterEvidence(page) {
  await page.evaluate(() => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context?.prototype) throw new Error('AudioContext indisponível no gate.');
    if (!Context.prototype.__pvOriginalCreateBiquadFilter) {
      Context.prototype.__pvOriginalCreateBiquadFilter = Context.prototype.createBiquadFilter;
      Context.prototype.createBiquadFilter = function patchedCreateBiquadFilter(...args) {
        const node = Context.prototype.__pvOriginalCreateBiquadFilter.apply(this, args);
        globalThis.__pvBiquadEvidence = globalThis.__pvBiquadEvidence || [];
        globalThis.__pvBiquadEvidence.push(node);
        return node;
      };
    }
    globalThis.__pvBiquadEvidence = [];
  });
}

async function resetFilterEvidence(page) {
  await page.evaluate(() => { globalThis.__pvBiquadEvidence = []; });
}

async function filterEvidence(page) {
  return page.evaluate(() => (globalThis.__pvBiquadEvidence || []).map((node) => ({
    type: node.type,
    frequencyHz: Math.round(Number(node.frequency?.value || 0)),
    q: Number(node.Q?.value || 0),
    gainDb: Number(node.gain?.value || 0),
  })));
}

test('WEB VOCAL BODY GATE: peaking EQ is regional, audible, A/B isolated and selectively undoable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate corpo vocal regional');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'body.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('body.wav').first()).toBeVisible();
  await seedProject(page);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'dá mais corpo à minha voz 5 dB no refrão');
  await expect(page.getByText(/só aplico até \+3 dB de EQ regional/i).last()).toBeVisible();

  await sendPablo(page, 'dá mais corpo à minha voz só no refrão');
  await expect(page.getByText(/EQ largo de \+1\.5 dB em 220 Hz/i).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Studio · corpo regional salvo/i).last()).toBeVisible();

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    const event = vocal.regionAutomation.find((item) => item.source === 'pablo_section_vocal_body');
    vocal.regionAutomation.push({
      id: `manual_peaking:${project.arrangementMap.sections[0].id}`,
      kind: 'peaking_eq', startSeconds: 0.3, endSeconds: 0.95,
      gainDb: 1, frequencyHz: 900, q: 1.1, confidence: 1, source: 'user_manual', enabled: true,
    });
    await storage.saveProject(project);
    return { event, supportCount: support.regionAutomation.length };
  });
  expect(saved.event.kind).toBe('peaking_eq');
  expect(saved.event.frequencyHz).toBe(220);
  expect(saved.event.q).toBe(0.82);
  expect(saved.event.gainDb).toBe(1.5);
  expect(saved.event.startSeconds).toBe(0.3);
  expect(saved.event.endSeconds).toBe(0.95);
  expect(saved.supportCount).toBe(0);

  await sendPablo(page, 'deixa minha voz mais quente no refrão');
  const repeatedCount = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.filter((event) => event.source === 'pablo_section_vocal_body').length;
  });
  expect(repeatedCount).toBe(1);

  await installFilterEvidence(page);
  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(120);
  const a = await filterEvidence(page);
  expect(a.some((item) => item.type === 'peaking' && item.frequencyHz === 900)).toBe(true);
  expect(a.some((item) => item.type === 'peaking' && item.frequencyHz === 220)).toBe(false);
  const persistedAfterA = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.map((event) => event.source).sort();
  });
  expect(persistedAfterA).toEqual(['pablo_section_vocal_body', 'user_manual']);

  await resetFilterEvidence(page);
  await panel.getByRole('button', { name: 'Ouvir B' }).click();
  await page.waitForTimeout(120);
  const b = await filterEvidence(page);
  expect(b.some((item) => item.type === 'peaking' && item.frequencyHz === 900)).toBe(true);
  expect(b.some((item) => item.type === 'peaking' && item.frequencyHz === 220 && item.gainDb > 1.4)).toBe(true);

  await sendPablo(page, 'desfaz o corpo da minha voz no refrão');
  await expect(page.getByText(/Desfiz o corpo vocal que eu tinha criado no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => ({ source: event.source, kind: event.kind, frequencyHz: event.frequencyHz, q: event.q }));
  });
  expect(afterUndo).toEqual([{ source: 'user_manual', kind: 'peaking_eq', frequencyHz: 900, q: 1.1 }]);

  await sendPablo(page, 'compara o refrão');
  await expect(page.getByText(/Não há ajustes regionais meus nesse refrão para fazer A\/B/i).last()).toBeVisible();

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

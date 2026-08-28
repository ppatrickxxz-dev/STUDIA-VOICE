import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.6, sampleRate = 44100, frequency = 350 } = {}) {
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
    gainDb: Number(node.gain?.value || 0),
  })));
}

test('WEB VOCAL BRIGHTNESS GATE: high shelf is regional, audible, A/B isolated and selectively undoable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate brilho vocal regional');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'brightness.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('brightness.wav').first()).toBeVisible();
  await seedProject(page);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'dá mais brilho à minha voz 8 dB no refrão');
  await expect(page.getByText(/só aplico até \+4 dB de high-shelf regional/i).last()).toBeVisible();

  await sendPablo(page, 'dá mais brilho à minha voz só no refrão');
  await expect(page.getByText(/high-shelf de \+2\.5 dB a partir de 6\.5 kHz/i).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Studio · brilho regional salvo/i).last()).toBeVisible();

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    const event = vocal.regionAutomation.find((item) => item.source === 'pablo_section_vocal_brightness');
    vocal.regionAutomation.push({
      id: `manual_high_shelf:${project.arrangementMap.sections[0].id}`,
      kind: 'high_shelf', startSeconds: 0.3, endSeconds: 0.95,
      gainDb: 1, frequencyHz: 8000, confidence: 1, source: 'user_manual', enabled: true,
    });
    await storage.saveProject(project);
    return { event, supportCount: support.regionAutomation.length };
  });
  expect(saved.event.kind).toBe('high_shelf');
  expect(saved.event.frequencyHz).toBe(6500);
  expect(saved.event.gainDb).toBe(2.5);
  expect(saved.event.startSeconds).toBe(0.3);
  expect(saved.event.endSeconds).toBe(0.95);
  expect(saved.supportCount).toBe(0);

  await sendPablo(page, 'dá mais brilho à minha voz no refrão');
  const repeatedCount = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.filter((event) => event.source === 'pablo_section_vocal_brightness').length;
  });
  expect(repeatedCount).toBe(1);

  await installFilterEvidence(page);
  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(120);
  const a = await filterEvidence(page);
  expect(a.some((item) => item.type === 'highshelf' && item.frequencyHz === 8000)).toBe(true);
  expect(a.some((item) => item.type === 'highshelf' && item.frequencyHz === 6500)).toBe(false);
  const persistedAfterA = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.map((event) => event.source).sort();
  });
  expect(persistedAfterA).toEqual(['pablo_section_vocal_brightness', 'user_manual']);

  await resetFilterEvidence(page);
  await panel.getByRole('button', { name: 'Ouvir B' }).click();
  await page.waitForTimeout(120);
  const b = await filterEvidence(page);
  expect(b.some((item) => item.type === 'highshelf' && item.frequencyHz === 8000)).toBe(true);
  expect(b.some((item) => item.type === 'highshelf' && item.frequencyHz === 6500 && item.gainDb > 2)).toBe(true);

  await sendPablo(page, 'desfaz o brilho da minha voz no refrão');
  await expect(page.getByText(/Desfiz o brilho vocal que eu tinha criado no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => ({ source: event.source, kind: event.kind, frequencyHz: event.frequencyHz }));
  });
  expect(afterUndo).toEqual([{ source: 'user_manual', kind: 'high_shelf', frequencyHz: 8000 }]);

  await sendPablo(page, 'compara o refrão');
  await expect(page.getByText(/Não há ajustes regionais meus nesse refrão para fazer A\/B/i).last()).toBeVisible();

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

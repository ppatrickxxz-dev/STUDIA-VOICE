import { test, expect } from '@playwright/test';

function plosiveWavFixture({ seconds = 1.6, sampleRate = 16000 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    let value = Math.sin(2 * Math.PI * 220 * time) * 0.018;
    for (const at of [0.45, 1.18]) {
      const local = time - at;
      if (local >= 0 && local <= 0.065) value += Math.sin(2 * Math.PI * 120 * time) * 0.42 * Math.exp(-local * 42);
    }
    const edge = Math.min(1, index / 300, (samples - index) / 300);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value * Math.max(0, edge))) * 32767), 44 + index * 2);
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

async function installBiquadEvidence(page) {
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
async function resetBiquadEvidence(page) { await page.evaluate(() => { globalThis.__pvBiquadEvidence = []; }); }
async function biquadEvidence(page) {
  return page.evaluate(() => (globalThis.__pvBiquadEvidence || []).map((node) => ({ type: node.type, frequencyHz: Number(node.frequency?.value || 0), q: Number(node.Q?.value || 0) })));
}

test('WEB VOCAL PLOSIVE GATE: measured P/B burst creates only low-frequency micro cuts and stays A/B/undo isolated', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate plosivas vocais');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'plosives.wav', mimeType: 'audio/wav', buffer: plosiveWavFixture() });
  await expect(page.getByText('plosives.wav').first()).toBeVisible();
  await seedProject(page);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'tira as plosivas 8 dB no refrão');
  await expect(page.getByText(/só aplico automaticamente entre 0,5 e 6 dB/i).last()).toBeVisible();

  await sendPablo(page, 'segura os P e B da minha voz só no refrão');
  await expect(page.getByText(/Encontrei \d+ plosiva\(s\).*reduzi só os estouros/i).last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Studio · plosivas tratadas/i).last()).toBeVisible();

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    const section = project.arrangementMap.sections[0];
    const events = vocal.regionAutomation.filter((item) => item.source === 'pablo_section_vocal_plosive');
    vocal.regionAutomation.push({
      id: `manual_peaking:${section.id}`, kind: 'peaking_eq', startSeconds: 0.3, endSeconds: 0.95,
      gainDb: 1.1, frequencyHz: 900, q: 1, confidence: 1, source: 'user_manual', enabled: true,
    });
    await storage.saveProject(project);
    return { events, supportCount: support.regionAutomation.length, sectionId: section.id };
  });
  expect(saved.events.length).toBeGreaterThanOrEqual(1);
  expect(saved.supportCount).toBe(0);
  for (const event of saved.events) {
    expect(event.kind).toBe('peaking_eq');
    expect(event.frequencyHz).toBeGreaterThanOrEqual(100);
    expect(event.frequencyHz).toBeLessThanOrEqual(140);
    expect(event.gainDb).toBeLessThan(0);
    expect(event.startSeconds).toBeGreaterThanOrEqual(0.3);
    expect(event.endSeconds).toBeLessThanOrEqual(0.95);
    expect(event.endSeconds - event.startSeconds).toBeLessThan(0.3);
    expect(event.id.endsWith(`:${saved.sectionId}`)).toBe(true);
  }

  await installBiquadEvidence(page);
  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(140);
  const a = await biquadEvidence(page);
  expect(a.some((item) => item.type === 'peaking' && Math.abs(item.frequencyHz - 900) < 5)).toBe(true);
  expect(a.some((item) => item.type === 'peaking' && item.frequencyHz >= 80 && item.frequencyHz <= 260)).toBe(false);

  await resetBiquadEvidence(page);
  await panel.getByRole('button', { name: 'Ouvir B' }).click();
  await page.waitForTimeout(140);
  const b = await biquadEvidence(page);
  expect(b.some((item) => item.type === 'peaking' && Math.abs(item.frequencyHz - 900) < 5)).toBe(true);
  expect(b.some((item) => item.type === 'peaking' && item.frequencyHz >= 100 && item.frequencyHz <= 140)).toBe(true);

  await sendPablo(page, 'desfaz as plosivas no refrão');
  await expect(page.getByText(/Desfiz o tratamento de plosivas.*Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.map((event) => ({ source: event.source, kind: event.kind, frequencyHz: event.frequencyHz, gainDb: event.gainDb }));
  });
  expect(afterUndo).toEqual([{ source: 'user_manual', kind: 'peaking_eq', frequencyHz: 900, gainDb: 1.1 }]);

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

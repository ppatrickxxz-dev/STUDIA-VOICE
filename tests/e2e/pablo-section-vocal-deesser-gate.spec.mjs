import { test, expect } from '@playwright/test';

function sibilanceWavFixture({ seconds = 1.6, sampleRate = 44100 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  let noise = 0x12345678;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const firstBurst = time >= 0.45 && time <= 0.56;
    const secondBurst = time >= 1.18 && time <= 1.29;
    const sibilant = firstBurst || secondBurst;
    let value;
    if (sibilant) {
      noise = (1664525 * noise + 1013904223) >>> 0;
      const input = ((noise / 0xffffffff) * 2) - 1;
      const centerHz = firstBurst ? 9500 : 10000;
      const radius = 0.94;
      const coefficient = 2 * radius * Math.cos(2 * Math.PI * centerHz / sampleRate);
      const y = input + coefficient * y1 - (radius * radius) * y2;
      y2 = y1;
      y1 = y;
      value = Math.max(-1, Math.min(1, y * 0.025));
    } else {
      y1 = 0;
      y2 = 0;
      value = Math.sin(2 * Math.PI * 220 * time) * 0.08;
    }
    const edge = Math.min(1, index / 500, (samples - index) / 500);
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
  return page.evaluate(() => (globalThis.__pvBiquadEvidence || []).map((node) => ({
    type: node.type,
    frequencyHz: Number(node.frequency?.value || 0),
    q: Number(node.Q?.value || 0),
  })));
}

function containsAdaptiveBand(nodes, frequencies) {
  return nodes.some((item) => item.type === 'peaking' && frequencies.some((frequencyHz) => Math.abs(item.frequencyHz - frequencyHz) < 75));
}

test('WEB VOCAL DEESSER GATE: measured sibilance band drives only micro EQ windows and stays A/B/undo isolated', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate de-esser vocal adaptativo');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'deesser-adaptive.wav', mimeType: 'audio/wav', buffer: sibilanceWavFixture() });
  await expect(page.getByText('deesser-adaptive.wav').first()).toBeVisible();
  await seedProject(page);

  const measuredEvidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const runtime = await import('./audio-analysis-runtime.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const analysis = await runtime.analyzeAudioTrack(vocal);
    return analysis.voice.sibilanceEvents.map((event) => ({
      start: event.start,
      end: event.end,
      frequencyHz: event.frequencyHz,
      spectralConfidence: event.spectralConfidence,
      spectralSource: event.spectralSource,
    }));
  });
  const inChorusEvidence = measuredEvidence.filter((event) => event.start < 0.95 && event.end > 0.3);
  expect(inChorusEvidence.length).toBeGreaterThanOrEqual(1);
  expect(inChorusEvidence.some((event) => Number.isFinite(event.frequencyHz) && event.frequencyHz >= 8000 && event.frequencyHz <= 10800)).toBe(true);
  expect(inChorusEvidence.some((event) => event.spectralConfidence >= 0.12)).toBe(true);
  expect(inChorusEvidence.some((event) => event.spectralSource === 'local-sibilance-spectrum-v1')).toBe(true);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'tira os esses da minha voz 8 dB no refrão');
  await expect(page.getByText(/só aplico automaticamente entre 0,5 e 5 dB/i).last()).toBeVisible();

  await sendPablo(page, 'segura os esses da minha voz só no refrão');
  await expect(page.getByText(/Encontrei \d+ sibilância\(s\).*não usei uma frequência fixa/i).last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Studio · de-esser adaptativo salvo/i).last()).toBeVisible();

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    const section = project.arrangementMap.sections[0];
    const events = vocal.regionAutomation.filter((item) => item.source === 'pablo_section_vocal_deesser');
    vocal.regionAutomation.push({
      id: `manual_peaking:${section.id}`, kind: 'peaking_eq', startSeconds: 0.3, endSeconds: 0.95,
      gainDb: 1.1, frequencyHz: 900, q: 1, confidence: 1, source: 'user_manual', enabled: true,
    });
    await storage.saveProject(project);
    return { schemaVersion: project.schemaVersion, events, supportCount: support.regionAutomation.length, sectionId: section.id };
  });
  expect(saved.schemaVersion).toBe(8);
  expect(saved.events.length).toBeGreaterThanOrEqual(1);
  expect(saved.supportCount).toBe(0);
  for (const event of saved.events) {
    expect(event.kind).toBe('peaking_eq');
    expect(event.frequencyHz).toBeGreaterThanOrEqual(8000);
    expect(event.frequencyHz).toBeLessThanOrEqual(10800);
    expect(Math.abs(event.frequencyHz - 7200)).toBeGreaterThan(300);
    expect(event.gainDb).toBeLessThan(0);
    expect(event.startSeconds).toBeGreaterThanOrEqual(0.3);
    expect(event.endSeconds).toBeLessThanOrEqual(0.95);
    expect(event.endSeconds - event.startSeconds).toBeLessThan(0.5);
    expect(event.id.endsWith(`:${saved.sectionId}`)).toBe(true);
  }
  const adaptiveFrequencies = saved.events.map((event) => event.frequencyHz);

  await installBiquadEvidence(page);
  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(140);
  const a = await biquadEvidence(page);
  expect(a.some((item) => item.type === 'peaking' && Math.abs(item.frequencyHz - 900) < 5)).toBe(true);
  expect(containsAdaptiveBand(a, adaptiveFrequencies)).toBe(false);

  const persistedAfterA = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.map((event) => event.source).sort();
  });
  expect(persistedAfterA.filter((source) => source === 'pablo_section_vocal_deesser').length).toBe(saved.events.length);
  expect(persistedAfterA.includes('user_manual')).toBe(true);

  await resetBiquadEvidence(page);
  await panel.getByRole('button', { name: 'Ouvir B' }).click();
  await page.waitForTimeout(140);
  const b = await biquadEvidence(page);
  expect(b.some((item) => item.type === 'peaking' && Math.abs(item.frequencyHz - 900) < 5)).toBe(true);
  expect(containsAdaptiveBand(b, adaptiveFrequencies)).toBe(true);

  await sendPablo(page, 'desfaz o de-esser no refrão');
  await expect(page.getByText(/Desfiz o de-esser vocal que eu tinha criado no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.find((track) => track.kind === 'recording').regionAutomation.map((event) => ({ source: event.source, kind: event.kind, frequencyHz: event.frequencyHz, gainDb: event.gainDb }));
  });
  expect(afterUndo).toEqual([{ source: 'user_manual', kind: 'peaking_eq', frequencyHz: 900, gainDb: 1.1 }]);

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

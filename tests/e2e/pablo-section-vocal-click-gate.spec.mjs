import { test, expect } from '@playwright/test';

function clickWavFixture({ seconds = 1.6, sampleRate = 44100 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  const clickPattern = [0.72, -0.56, 0.43, -0.31, 0.21, -0.13, 0.07];
  const clickStarts = [0.5, 1.25].map((time) => Math.floor(time * sampleRate));
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    let value = Math.sin(2 * Math.PI * 220 * time) * 0.02;
    if (time >= 0.62 && time <= 0.69) value += Math.sin(2 * Math.PI * 220 * time) * 0.27;
    const plosiveLocal = time - 0.76;
    if (plosiveLocal >= 0 && plosiveLocal <= 0.065) value += Math.sin(2 * Math.PI * 120 * time) * 0.42 * Math.exp(-plosiveLocal * 38);
    for (const start of clickStarts) {
      const offset = index - start;
      if (offset >= 0 && offset < clickPattern.length) value += clickPattern[offset];
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

function overlaps(a, b, padding = 0) {
  return Math.min(a.end + padding, b.end + padding) > Math.max(a.start - padding, b.start - padding);
}

test('WEB VOCAL CLICK GATE: short broadband clicks are isolated from plosives and sustained peaks, then stay A/B/undo safe', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate estalos vocais');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'vocal-clicks.wav', mimeType: 'audio/wav', buffer: clickWavFixture() });
  await expect(page.getByText('vocal-clicks.wav').first()).toBeVisible();
  await seedProject(page);

  const evidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const runtime = await import('./audio-analysis-runtime.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const analysis = await runtime.analyzeAudioTrack(vocal);
    return {
      clicks: analysis.voice.clickEvents,
      plosives: analysis.voice.plosiveEvents,
      peaks: analysis.voice.peakEvents,
      source: analysis.voice.eventDetection.source,
    };
  });
  expect(evidence.source).toBe('local-heuristic-v1');
  expect(evidence.clicks.length).toBeGreaterThanOrEqual(2);
  const insideClick = evidence.clicks.find((item) => item.start < 0.56 && item.end > 0.46);
  const outsideClick = evidence.clicks.find((item) => item.start < 1.31 && item.end > 1.19);
  expect(insideClick).toBeTruthy();
  expect(outsideClick).toBeTruthy();
  expect(insideClick.end - insideClick.start).toBeLessThanOrEqual(0.05);
  expect(insideClick.differenceRatio).toBeGreaterThanOrEqual(0.45);
  expect(insideClick.lowFrequencyRatio).toBeLessThanOrEqual(0.58);
  for (const click of evidence.clicks) {
    expect(evidence.plosives.some((item) => overlaps(click, item, 0.008))).toBe(false);
    expect(evidence.peaks.some((item) => item.end - item.start >= 0.05 && overlaps(click, item, 0.006))).toBe(false);
  }

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'tira os estalos de boca da minha voz 10 dB no refrão');
  await expect(page.getByText(/só aplico automaticamente entre 0,5 e 7 dB/i).last()).toBeVisible();

  await sendPablo(page, 'tira os estalos de boca da minha voz só no refrão');
  await expect(page.getByText(/Encontrei \d+ estalo\(s\) curto\(s\).*microjanelas/i).last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Studio · estalos tratados/i).last()).toBeVisible();

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    const section = project.arrangementMap.sections[0];
    vocal.regionAutomation.push({ id: `manual_gain:${section.id}`, kind: 'gain', startSeconds: 0.3, endSeconds: 0.95, gainDb: 0.8, confidence: 1, source: 'user_manual', enabled: true });
    await storage.saveProject(project);
    return {
      events: vocal.regionAutomation.filter((item) => item.source === 'pablo_section_vocal_click'),
      supportCount: support.regionAutomation.length,
      sectionId: section.id,
    };
  });
  expect(saved.events.length).toBeGreaterThanOrEqual(1);
  expect(saved.supportCount).toBe(0);
  for (const event of saved.events) {
    expect(event.kind).toBe('gain');
    expect(event.gainDb).toBeLessThan(0);
    expect(event.startSeconds).toBeGreaterThanOrEqual(0.3);
    expect(event.endSeconds).toBeLessThanOrEqual(0.95);
    expect(event.endSeconds - event.startSeconds).toBeLessThan(0.07);
    expect(event.id.endsWith(`:${saved.sectionId}`)).toBe(true);
  }
  expect(saved.events.some((event) => event.startSeconds > 1)).toBe(false);

  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(100);
  const afterA = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => event.source).sort();
  });
  expect(afterA.filter((source) => source === 'pablo_section_vocal_click').length).toBe(saved.events.length);
  expect(afterA.includes('user_manual')).toBe(true);

  await sendPablo(page, 'desfaz os estalos no refrão');
  await expect(page.getByText(/Desfiz o tratamento de estalos que eu tinha criado no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => ({ source: event.source, kind: event.kind, gainDb: event.gainDb }));
  });
  expect(afterUndo.some((event) => event.source === 'pablo_section_vocal_click')).toBe(false);
  expect(afterUndo.some((event) => event.source === 'user_manual' && event.gainDb === 0.8)).toBe(true);

  await sendPablo(page, 'limpa minha voz só no refrão');
  await expect(page.getByText(/estalo\(s\) curto\(s\) atenuado\(s\)/i).last()).toBeVisible({ timeout: 15_000 });
  const cleanup = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => event.source);
  });
  expect(cleanup.includes('pablo_section_vocal_cleanup_click')).toBe(true);
  expect(cleanup.includes('user_manual')).toBe(true);

  await sendPablo(page, 'desfaz a limpeza no refrão');
  await expect(page.getByText(/Desfiz a limpeza vocal que eu tinha criado no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const finalSources = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => event.source);
  });
  expect(finalSources).toEqual(['user_manual']);

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

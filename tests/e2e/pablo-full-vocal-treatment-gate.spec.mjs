import { test, expect } from '@playwright/test';

function treatmentWavFixture({ seconds = 1.75, sampleRate = 44100 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);

  let noise = 0x2468ace0;
  let breathState = 0;
  let s1 = 0;
  let s2 = 0;
  const clickPattern = [0.72, -0.56, 0.43, -0.31, 0.21, -0.13, 0.07];
  const clickStart = Math.floor(0.91 * sampleRate);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    let value = Math.sin(2 * Math.PI * 220 * time) * 0.03;

    if (time >= 0.28 && time <= 0.41) {
      noise = (1664525 * noise + 1013904223) >>> 0;
      const raw = (((noise / 0xffffffff) * 2) - 1) * 0.13;
      breathState = 0.78 * breathState + 0.22 * raw;
      value = breathState;
    } else breathState = 0;

    for (const at of [0.49, 1.42]) {
      const local = time - at;
      if (local >= 0 && local <= 0.065) value += Math.sin(2 * Math.PI * 120 * time) * 0.44 * Math.exp(-local * 42);
    }

    const inSibilance = time >= 0.70 && time <= 0.82;
    const outsideSibilance = time >= 1.48 && time <= 1.59;
    if (inSibilance || outsideSibilance) {
      noise = (1664525 * noise + 1013904223) >>> 0;
      const input = ((noise / 0xffffffff) * 2) - 1;
      const centerHz = inSibilance ? 9500 : 10000;
      const radius = 0.94;
      const coefficient = 2 * radius * Math.cos(2 * Math.PI * centerHz / sampleRate);
      const y = input + coefficient * s1 - (radius * radius) * s2;
      s2 = s1; s1 = y;
      value = Math.max(-1, Math.min(1, y * 0.026));
    } else {
      s1 = 0; s2 = 0;
    }

    const clickOffset = index - clickStart;
    if (clickOffset >= 0 && clickOffset < clickPattern.length) value += clickPattern[clickOffset];

    for (const at of [1.00, 1.12]) {
      const local = time - at;
      if (local >= 0 && local <= 0.038) value += Math.sin(2 * Math.PI * 440 * time) * 0.68 * Math.exp(-local * 34);
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
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 0.2, endSeconds: 1.25, source: 'user_manual', confidence: 1 });
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 1.25, endSeconds: 1.7, source: 'user_manual', confidence: 1 });
    const first = project.arrangementMap.sections[0];
    vocal.regionAutomation.push({ id: `manual_gain:${first.id}`, kind: 'gain', startSeconds: 0.2, endSeconds: 1.25, gainDb: 0.8, confidence: 1, source: 'user_manual', enabled: true });
    await storage.saveProject(project);
  });
}

async function projectState(page) {
  return page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return {
      updatedAt: project.updatedAt,
      revisions: project.revisions.length,
      sectionIds: project.arrangementMap.sections.map((section) => section.id),
      automation: vocal.regionAutomation.map((event) => ({ id: event.id, kind: event.kind, source: event.source, enabled: event.enabled })),
    };
  });
}

test('WEB FULL VOCAL TREATMENT GATE: Pablo treats the highest-priority confirmed sections and persists only canonical cleanup automation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate tratamento vocal por prioridade');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'full-vocal-treatment.wav', mimeType: 'audio/wav', buffer: treatmentWavFixture() });
  await expect(page.getByText('full-vocal-treatment.wav').first()).toBeVisible();
  await seedProject(page);

  const evidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const runtime = await import('./audio-analysis-runtime.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const analysis = await runtime.analyzeAudioTrack(vocal);
    return {
      sibilance: analysis.voice.sibilanceEvents?.length || 0,
      plosives: analysis.voice.plosiveEvents?.length || 0,
      clicks: analysis.voice.clickEvents?.length || 0,
      peaks: analysis.voice.peakEvents?.length || 0,
    };
  });
  expect(evidence.sibilance).toBeGreaterThanOrEqual(2);
  expect(evidence.plosives).toBeGreaterThanOrEqual(2);
  expect(evidence.clicks).toBeGreaterThanOrEqual(1);
  expect(evidence.peaks).toBeGreaterThanOrEqual(2);

  const before = await projectState(page);
  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'Pablo, trata minha voz inteira por prioridade top 2');
  await expect(page.getByText(/Tratei a voz por prioridade/i).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Studio · tratamento vocal por prioridade salvo/i).last()).toBeVisible();
  const reply = await page.locator('[data-pablo-log] .pv-msg.assistant').last().innerText();
  expect(reply).toMatch(/trechos mais críticos/i);
  expect(reply).toMatch(/1º refrão/i);
  expect(reply).toMatch(/2º refrão/i);
  expect(reply).toMatch(/Nada fora das seções escolhidas foi alterado/i);

  const after = await projectState(page);
  expect(after.updatedAt).not.toBe(before.updatedAt);
  expect(after.revisions).toBeGreaterThan(before.revisions);
  const sources = after.automation.map((event) => event.source);
  expect(sources.includes('user_manual')).toBe(true);
  expect(sources.some((source) => source === 'pablo_section_vocal_cleanup_deesser')).toBe(true);
  expect(sources.some((source) => source === 'pablo_section_vocal_cleanup_plosive')).toBe(true);
  expect(sources.some((source) => source === 'pablo_section_vocal_cleanup_click')).toBe(true);
  expect(sources.some((source) => source === 'pablo_section_vocal_cleanup_dynamics')).toBe(true);
  for (const sectionId of after.sectionIds) {
    expect(after.automation.some((event) => String(event.id).endsWith(`:${sectionId}`) && String(event.source).startsWith('pablo_section_vocal_cleanup_'))).toBe(true);
  }

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

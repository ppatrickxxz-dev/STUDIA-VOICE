import { test, expect } from '@playwright/test';

function scanWavFixture({ seconds = 1.75, sampleRate = 44100 } = {}) {
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
    const section = project.arrangementMap.sections[0];
    vocal.regionAutomation.push({ id: `manual_gain:${section.id}`, kind: 'gain', startSeconds: 0.2, endSeconds: 1.25, gainDb: 0.8, confidence: 1, source: 'user_manual', enabled: true });
    await storage.saveProject(project);
  });
}

async function projectFingerprint(page) {
  return page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return JSON.stringify({
      id: project.id,
      updatedAt: project.updatedAt,
      activeTrackId: project.activeTrackId,
      revisions: project.revisions,
      arrangementMap: project.arrangementMap,
      tracks: project.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        kind: track.kind,
        updatedAt: track.updatedAt,
        regionAutomation: track.regionAutomation,
      })),
    });
  });
}

test('WEB VOCAL SCAN GATE: Pablo diagnoses a confirmed chorus without mutating project state, then cleanup still uses the same evidence', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate diagnóstico vocal');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'vocal-scan.wav', mimeType: 'audio/wav', buffer: scanWavFixture() });
  await expect(page.getByText('vocal-scan.wav').first()).toBeVisible();
  await seedProject(page);

  const evidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const runtime = await import('./audio-analysis-runtime.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const analysis = await runtime.analyzeAudioTrack(vocal);
    const inside = (events) => (events || []).filter((event) => Number(event.start) < 1.25 && Number(event.end) > 0.2);
    return {
      sibilance: inside(analysis.voice.sibilanceEvents),
      plosives: inside(analysis.voice.plosiveEvents),
      clicks: inside(analysis.voice.clickEvents),
      peaks: inside(analysis.voice.peakEvents),
    };
  });
  expect(evidence.sibilance.length).toBeGreaterThanOrEqual(1);
  expect(evidence.plosives.some((event) => event.frequencyHz >= 80 && event.frequencyHz <= 260)).toBe(true);
  expect(evidence.clicks.length).toBeGreaterThanOrEqual(1);
  expect(evidence.peaks.length).toBeGreaterThanOrEqual(2);

  const before = await projectFingerprint(page);
  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'Pablo, analisa minha voz só no refrão');
  await expect(page.getByText(/Ouvi Refrão sem alterar nada/i).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Studio · diagnóstico vocal · somente leitura/i).last()).toBeVisible();
  const reply = await page.locator('[data-pablo-log] .pv-msg.assistant').last().innerText();
  expect(reply).toMatch(/Sibilância/i);
  expect(reply).toMatch(/Estouro de P\/B/i);
  expect(reply).toMatch(/Estalo curto/i);
  expect(reply).toMatch(/Pico de dinâmica/i);
  expect(reply).toMatch(/acionável/i);

  const after = await projectFingerprint(page);
  expect(after).toBe(before);

  await sendPablo(page, 'limpa minha voz só no refrão');
  await expect(page.getByText(/Limpei Refrão usando só o que encontrei na própria voz/i).last()).toBeVisible({ timeout: 20_000 });
  const cleanup = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return {
      sources: vocal.regionAutomation.map((event) => event.source),
      revisions: project.revisions.length,
    };
  });
  expect(cleanup.sources.includes('user_manual')).toBe(true);
  expect(cleanup.sources.some((source) => source === 'pablo_section_vocal_cleanup_deesser')).toBe(true);
  expect(cleanup.sources.some((source) => source === 'pablo_section_vocal_cleanup_plosive')).toBe(true);
  expect(cleanup.sources.some((source) => source === 'pablo_section_vocal_cleanup_click')).toBe(true);
  expect(cleanup.sources.some((source) => source === 'pablo_section_vocal_cleanup_dynamics')).toBe(true);

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

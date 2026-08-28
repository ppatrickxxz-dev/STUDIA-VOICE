import { test, expect } from '@playwright/test';

function humWavFixture({ seconds = 1.8, sampleRate = 44100 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);

  const humWindows = [[0.42, 0.76], [1.34, 1.64]];
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    let value = Math.sin(2 * Math.PI * 220 * time) * 0.025;
    for (const [start, end] of humWindows) {
      if (time < start || time > end) continue;
      const fade = Math.min(1, (time - start) / 0.035, (end - time) / 0.035);
      value = Math.sin(2 * Math.PI * 60 * time) * 0.014 * Math.max(0, fade);
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
    vocal.kind = 'recording';
    vocal.name = 'Voz principal';
    const support = core.createTrack({
      name: 'Instrumental', assetId: vocal.assetId, type: vocal.type, duration: vocal.duration,
      sampleRate: vocal.sampleRate, channels: vocal.channels, kind: 'audio',
    });
    project.tracks.push(support);
    project.activeTrackId = support.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus', startSeconds: 0.25, endSeconds: 1.05, source: 'user_manual', confidence: 1,
    });
    const section = project.arrangementMap.sections[0];
    vocal.regionAutomation.push({
      id: `manual:${section.id}`, kind: 'gain', startSeconds: 0.25, endSeconds: 1.05,
      gainDb: 0.8, confidence: 1, source: 'user_manual', enabled: true,
    });
    await storage.saveProject(project);
  });
}

async function projectFingerprint(page) {
  return page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return JSON.stringify({
      id: project.id,
      schemaVersion: project.schemaVersion,
      updatedAt: project.updatedAt,
      activeTrackId: project.activeTrackId,
      revisions: project.revisions,
      arrangementMap: project.arrangementMap,
      tracks: project.tracks.map((track) => ({
        id: track.id, name: track.name, kind: track.kind, updatedAt: track.updatedAt,
        regionAutomation: track.regionAutomation,
      })),
    });
  });
}

test('WEB VOCAL HUM GATE: 60 Hz hum is explained inside the section without automatic notch or project mutation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate classificação de hum');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'vocal-hum.wav', mimeType: 'audio/wav', buffer: humWavFixture() });
  await expect(page.getByText('vocal-hum.wav').first()).toBeVisible();
  await seedProject(page);

  const evidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const runtime = await import('./audio-analysis-runtime.mjs');
    const scan = await import('./core/src/section-vocal-scan.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const analysis = await runtime.analyzeAudioTrack(vocal);
    const command = scan.parseSectionVocalScanCommand('analisa minha voz só no refrão');
    const plan = scan.planSectionVocalScan(project, command, { analysis });
    return {
      schemaVersion: project.schemaVersion,
      noiseSource: analysis.voice.noiseDetection?.source,
      noiseEvents: analysis.voice.noiseEvents,
      restoration: analysis.voice.restoration,
      scanClassified: plan.findings.filter((finding) => finding.type === 'hum' || finding.type === 'broadband_noise'),
      readOnly: plan.readOnly,
    };
  });

  expect(evidence.schemaVersion).toBe(9);
  expect(evidence.noiseSource).toBe('local-stationary-noise-v1');
  expect(Array.isArray(evidence.restoration.windows)).toBe(true);
  const insideRaw = evidence.noiseEvents.find((event) => event.start < 0.8 && event.end > 0.4);
  expect(insideRaw).toBeTruthy();
  expect(insideRaw.noiseKind).toBe('hum');
  expect(insideRaw.frequencyHz).toBe(60);
  expect(evidence.readOnly).toBe(true);
  expect(evidence.scanClassified.some((finding) => finding.type === 'hum' && finding.frequencyHz === 60)).toBe(true);
  expect(evidence.scanClassified.every((finding) => finding.autoEdit === false)).toBe(true);
  expect(evidence.scanClassified.every((finding) => finding.timelineStartSeconds >= 0.25 && finding.timelineEndSeconds <= 1.05)).toBe(true);
  expect(evidence.scanClassified.some((finding) => finding.timelineStartSeconds > 1.05 || finding.timelineEndSeconds > 1.05)).toBe(false);

  const before = await projectFingerprint(page);
  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'Pablo, analisa minha voz só no refrão');
  await expect(page.getByText(/Ouvi Refrão sem alterar nada/i).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Studio · diagnóstico vocal · somente leitura/i).last()).toBeVisible();
  const reply = await page.locator('[data-pablo-log] .pv-msg.assistant').last().innerText();
  expect(reply).toMatch(/Hum de rede/i);
  expect(reply).toMatch(/60 Hz/i);
  expect(reply).toMatch(/classificação diagnóstica/i);
  expect(reply).toMatch(/não apliquei notch de 50\/60 Hz automaticamente/i);

  const after = await projectFingerprint(page);
  expect(after).toBe(before);

  const persisted = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => ({ source: event.source, kind: event.kind, gainDb: event.gainDb }));
  });
  expect(persisted).toEqual([{ source: 'user_manual', kind: 'gain', gainDb: 0.8 }]);

  const unexpected = errors.filter((message) => !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

import { test, expect } from '@playwright/test';

function restorationWavFixture({ seconds = 3, sampleRate = 16000, reflectionDelayMs = 36, reflectionAmount = 0.18 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const pcm = new Float32Array(samples);
  const voiceRanges = [[0.18, 0.58], [0.82, 1.22], [1.48, 1.88], [2.12, 2.52]];
  let random = 0x12345678;
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    random = (1664525 * random + 1013904223) >>> 0;
    let value = (((random / 0xffffffff) * 2) - 1) * 0.008;
    for (const [start, end] of voiceRanges) {
      if (time < start || time >= end) continue;
      const phase = (time - start) / (end - start);
      const envelope = Math.min(1, phase / 0.035, (1 - phase) / 0.05);
      value += envelope * (0.12 * Math.sin(2 * Math.PI * 220 * time) + 0.045 * Math.sin(2 * Math.PI * 660 * time));
    }
    pcm[index] = value;
  }
  const delay = Math.round(reflectionDelayMs * sampleRate / 1000);
  for (let index = samples - 1; index >= delay; index -= 1) pcm[index] += reflectionAmount * pcm[index - delay];

  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[index])) * 32767), 44 + index * 2);
  }
  return buffer;
}

async function sendPablo(page, message) {
  const form = page.locator('[data-pablo-form]');
  await form.locator('input[name="message"]').fill(message);
  await form.getByRole('button', { name: 'Enviar' }).click();
}

async function seedVocalProject(page) {
  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks[0];
    vocal.kind = 'recording';
    vocal.name = 'Voz principal';
    project.activeTrackId = vocal.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus', startSeconds: 0.05, endSeconds: 2.9, source: 'user_manual', confidence: 1,
    });
    const section = project.arrangementMap.sections[0];
    vocal.regionAutomation.push({
      id: `manual:${section.id}`, kind: 'gain', startSeconds: 0.05, endSeconds: 2.9,
      gainDb: 0.2, confidence: 1, source: 'user_manual', enabled: true,
    });
    await storage.saveProject(project);
  });
}

test('WEB VOCAL RESTORATION GATE: scan explains, cleanup renders real PCM, A/B isolates and undo preserves original', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Vocal Restoration');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'restoration.wav', mimeType: 'audio/wav', buffer: restorationWavFixture() });
  await expect(page.getByText('restoration.wav').first()).toBeVisible();
  await seedVocalProject(page);

  const measured = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const runtime = await import('./audio-analysis-runtime.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const analysis = await runtime.analyzeAudioTrack(vocal);
    return {
      source: analysis.voice.restoration.source,
      noiseWindowCount: analysis.voice.restoration.noiseWindowCount,
      reverbWindowCount: analysis.voice.restoration.reverbWindowCount,
      guard: analysis.voice.restoration.timbreGuard,
    };
  });
  expect(measured.source).toBe('local-vocal-restoration-profile-v1');
  expect(measured.noiseWindowCount).toBeGreaterThanOrEqual(1);
  expect(measured.reverbWindowCount).toBeGreaterThanOrEqual(1);
  expect(measured.guard).toMatchObject({ pitchPreserving: true, formantPreserving: true });

  await page.locator('[data-route="pablo"]').first().click();
  const beforeScan = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    return JSON.stringify(await storage.getProject(storage.activeProjectSessionId()));
  });
  await sendPablo(page, 'Pablo, analisa minha voz só no refrão');
  await expect(page.getByText(/Ouvi Refrão sem alterar nada/i).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Ruído de fundo.*timbre protegido/i).last()).toBeVisible();
  await expect(page.getByText(/Reflexo do ambiente.*timbre protegido/i).last()).toBeVisible();
  const afterScan = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    return JSON.stringify(await storage.getProject(storage.activeProjectSessionId()));
  });
  expect(afterScan).toBe(beforeScan);

  await sendPablo(page, 'Pablo, limpa minha voz só no refrão');
  await expect(page.getByText(/ruído de fundo reduzido/i).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/reflexo do ambiente reduzido/i).last()).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const denoise = vocal.regionAutomation.filter((event) => event.source === 'pablo_section_vocal_cleanup_denoise');
    const dereverb = vocal.regionAutomation.filter((event) => event.source === 'pablo_section_vocal_cleanup_dereverb');
    return { denoise, dereverb, manual: vocal.regionAutomation.filter((event) => event.source === 'user_manual'), revisions: project.revisions.length };
  });
  expect(persisted.denoise.length).toBeGreaterThanOrEqual(1);
  expect(persisted.dereverb.length).toBeGreaterThanOrEqual(1);
  expect(persisted.denoise.every((event) => event.kind === 'vocal_denoise' && event.timbreProtected && event.voicedMarginDb >= 10 && event.reductionDb <= 5.5)).toBe(true);
  expect(persisted.dereverb.every((event) => event.kind === 'vocal_dereverb' && event.timbreProtected && event.amount <= 0.2 && event.reflectionDelayMs >= 18)).toBe(true);
  expect(persisted.manual).toHaveLength(1);
  expect(persisted.revisions).toBeGreaterThanOrEqual(1);

  const renderEvidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const { PabloAudioEngine } = await import('./audio-engine.mjs');
    const { buildSectionMixABVariant } = await import('./core/src/section-mix-ab.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const section = project.arrangementMap.sections[0];
    const asset = await storage.getAudioAsset(vocal.assetId);
    const engine = new PabloAudioEngine();
    await engine.decode(vocal.id, asset.blob);
    const original = engine.getBuffer(vocal.id);
    const originalProbe = Array.from(original.getChannelData(0).slice(0, 512));
    const aProject = buildSectionMixABVariant(project, section.id, 'A').project;
    const bProject = buildSectionMixABVariant(project, section.id, 'B').project;
    const a = await engine.renderTrack(aProject, vocal.id, 'demo');
    const b = await engine.renderTrack(bProject, vocal.id, 'demo');
    const rms = (buffer, startSeconds, endSeconds) => {
      const data = buffer.getChannelData(0);
      const start = Math.floor(startSeconds * buffer.sampleRate);
      const end = Math.min(data.length, Math.floor(endSeconds * buffer.sampleRate));
      let squares = 0;
      for (let index = start; index < end; index += 1) squares += data[index] ** 2;
      return Math.sqrt(squares / Math.max(1, end - start));
    };
    const quietA = rms(a, 0.1, 0.16);
    const quietB = rms(b, 0.1, 0.16);
    const activeA = rms(a, 0.92, 1.12);
    const activeB = rms(b, 0.92, 1.12);
    const db = (next, prior) => 20 * Math.log10(Math.max(1e-12, next) / Math.max(1e-12, prior));
    const toneMagnitude = (buffer, frequency, startSeconds, endSeconds) => {
      const data = buffer.getChannelData(0);
      const start = Math.floor(startSeconds * buffer.sampleRate);
      const end = Math.min(data.length, Math.floor(endSeconds * buffer.sampleRate));
      let sine = 0;
      let cosine = 0;
      for (let index = start; index < end; index += 1) {
        const phase = 2 * Math.PI * frequency * index / buffer.sampleRate;
        sine += data[index] * Math.sin(phase);
        cosine += data[index] * Math.cos(phase);
      }
      return 2 * Math.hypot(sine, cosine) / Math.max(1, end - start);
    };
    const timbreRatio = (buffer) => db(
      toneMagnitude(buffer, 660, 0.92, 1.12),
      toneMagnitude(buffer, 220, 0.92, 1.12),
    );
    return {
      quietDeltaDb: db(quietB, quietA),
      activeDeltaDb: db(activeB, activeA),
      timbreRatioDeltaDb: timbreRatio(b) - timbreRatio(a),
      originalUnchanged: originalProbe.every((value, index) => value === original.getChannelData(0)[index]),
      sameLength: a.length === b.length,
      sameSampleRate: a.sampleRate === b.sampleRate,
    };
  });
  expect(renderEvidence.quietDeltaDb).toBeLessThan(-1.2);
  expect(Math.abs(renderEvidence.activeDeltaDb)).toBeLessThan(2.2);
  expect(Math.abs(renderEvidence.timbreRatioDeltaDb)).toBeLessThan(1.8);
  expect(renderEvidence.originalUnchanged).toBe(true);
  expect(renderEvidence.sameLength).toBe(true);
  expect(renderEvidence.sameSampleRate).toBe(true);

  await page.evaluate(() => {
    globalThis.__pvRestorationEvents = [];
    globalThis.addEventListener('pablovoice:vocal-restoration-rendered', (event) => globalThis.__pvRestorationEvents.push(event.detail));
  });
  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => globalThis.__pvRestorationEvents.length)).toBe(0);
  await panel.getByRole('button', { name: 'Ouvir B' }).click();
  await page.waitForTimeout(180);
  const runtimeEvents = await page.evaluate(() => globalThis.__pvRestorationEvents);
  expect(runtimeEvents.some((event) => event.source === 'local-vocal-restoration-dsp-v1' && event.denoiseCount >= 1 && event.dereverbCount >= 1)).toBe(true);

  await sendPablo(page, 'desfaz a limpeza no refrão');
  await expect(page.getByText(/Desfiz a limpeza vocal.*Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => event.source);
  });
  expect(afterUndo.some((source) => source.startsWith('pablo_section_vocal_cleanup_'))).toBe(false);
  expect(afterUndo).toContain('user_manual');

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

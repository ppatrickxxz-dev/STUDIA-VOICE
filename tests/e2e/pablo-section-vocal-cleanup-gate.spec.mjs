import { test, expect } from '@playwright/test';

function cleanupWavFixture({ seconds = 1.75, sampleRate = 44100 } = {}) {
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
    vocal.regionAutomation.push(
      { id: `manual_peaking:${section.id}`, kind: 'peaking_eq', startSeconds: 0.2, endSeconds: 1.25, gainDb: 1.1, frequencyHz: 900, q: 1, confidence: 1, source: 'user_manual', enabled: true },
      { id: `pablo_section_vocal_deesser:${vocal.id}:independent:${section.id}`, kind: 'peaking_eq', startSeconds: 0.74, endSeconds: 0.79, gainDb: -1.5, frequencyHz: 8600, q: 1.5, confidence: 1, source: 'pablo_section_vocal_deesser', enabled: true },
    );
    await storage.saveProject(project);
  });
}

async function installAudioNodeEvidence(page) {
  await page.evaluate(() => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context?.prototype) throw new Error('AudioContext indisponível no gate.');
    if (!Context.prototype.__pvCleanupOriginalBiquad) {
      Context.prototype.__pvCleanupOriginalBiquad = Context.prototype.createBiquadFilter;
      Context.prototype.createBiquadFilter = function patchedBiquad(...args) {
        const node = Context.prototype.__pvCleanupOriginalBiquad.apply(this, args);
        globalThis.__pvCleanupBiquads = globalThis.__pvCleanupBiquads || [];
        globalThis.__pvCleanupBiquads.push(node);
        return node;
      };
    }
    if (!Context.prototype.__pvCleanupOriginalCompressor) {
      Context.prototype.__pvCleanupOriginalCompressor = Context.prototype.createDynamicsCompressor;
      Context.prototype.createDynamicsCompressor = function patchedCompressor(...args) {
        const node = Context.prototype.__pvCleanupOriginalCompressor.apply(this, args);
        globalThis.__pvCleanupCompressors = globalThis.__pvCleanupCompressors || [];
        globalThis.__pvCleanupCompressors.push(node);
        return node;
      };
    }
    globalThis.__pvCleanupBiquads = [];
    globalThis.__pvCleanupCompressors = [];
  });
}
async function resetAudioNodeEvidence(page) {
  await page.evaluate(() => { globalThis.__pvCleanupBiquads = []; globalThis.__pvCleanupCompressors = []; });
}
async function audioNodeEvidence(page) {
  return page.evaluate(() => ({
    biquads: (globalThis.__pvCleanupBiquads || []).map((node) => ({ type: node.type, frequencyHz: Number(node.frequency?.value || 0), q: Number(node.Q?.value || 0) })),
    compressors: (globalThis.__pvCleanupCompressors || []).map((node) => ({ ratio: Number(node.ratio?.value || 0), threshold: Number(node.threshold?.value || 0) })),
  }));
}

test('WEB VOCAL CLEANUP GATE: one command applies only evidence-backed modules and stays A/B/undo/provenance safe', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Vocal Cleanup');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'cleanup.wav', mimeType: 'audio/wav', buffer: cleanupWavFixture() });
  await expect(page.getByText('cleanup.wav').first()).toBeVisible();
  await seedProject(page);

  const evidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const runtime = await import('./audio-analysis-runtime.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const analysis = await runtime.analyzeAudioTrack(vocal);
    const inside = (events) => (events || []).filter((event) => Number(event.start) < 1.25 && Number(event.end) > 0.2);
    return {
      breaths: inside(analysis.voice.breathEvents),
      sibilance: inside(analysis.voice.sibilanceEvents),
      plosives: inside(analysis.voice.plosiveEvents),
      peaks: inside(analysis.voice.peakEvents),
    };
  });
  expect(evidence.sibilance.length).toBeGreaterThanOrEqual(1);
  expect(evidence.sibilance.some((event) => event.frequencyHz >= 8000 && event.frequencyHz <= 10800)).toBe(true);
  expect(evidence.plosives.length).toBeGreaterThanOrEqual(1);
  expect(evidence.plosives.some((event) => event.frequencyHz >= 80 && event.frequencyHz <= 260)).toBe(true);
  expect(evidence.peaks.length).toBeGreaterThanOrEqual(2);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'Pablo, limpa minha voz só no refrão');
  await expect(page.getByText(/Limpei Refrão usando só o que encontrei na própria voz/i).last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Studio · limpeza vocal salva/i).last()).toBeVisible();

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    const section = project.arrangementMap.sections[0];
    const cleanupSources = [
      'pablo_section_vocal_cleanup_breath',
      'pablo_section_vocal_cleanup_deesser',
      'pablo_section_vocal_cleanup_plosive',
      'pablo_section_vocal_cleanup_dynamics',
    ];
    return {
      sectionId: section.id,
      cleanup: vocal.regionAutomation.filter((event) => cleanupSources.includes(event.source)),
      manual: vocal.regionAutomation.filter((event) => event.source === 'user_manual'),
      independent: vocal.regionAutomation.filter((event) => event.source === 'pablo_section_vocal_deesser'),
      supportCount: support.regionAutomation.length,
      revisions: project.revisions.length,
    };
  });
  expect(saved.cleanup.length).toBeGreaterThanOrEqual(3);
  expect(saved.cleanup.every((event) => event.startSeconds >= 0.2 && event.endSeconds <= 1.25)).toBe(true);
  expect(saved.cleanup.every((event) => event.id.endsWith(`:${saved.sectionId}`))).toBe(true);
  expect(saved.cleanup.some((event) => event.source === 'pablo_section_vocal_cleanup_deesser' && event.frequencyHz >= 8000)).toBe(true);
  expect(saved.cleanup.some((event) => event.source === 'pablo_section_vocal_cleanup_plosive' && event.frequencyHz >= 80 && event.frequencyHz <= 260)).toBe(true);
  expect(saved.cleanup.some((event) => event.source === 'pablo_section_vocal_cleanup_dynamics' && event.kind === 'compressor')).toBe(true);
  const autoBreaths = evidence.breaths.filter((event) => event.confidence >= 0.82 && event.intensity >= 0.7).length;
  expect(saved.cleanup.filter((event) => event.source === 'pablo_section_vocal_cleanup_breath').length).toBe(autoBreaths);
  expect(saved.manual.length).toBe(1);
  expect(saved.independent.length).toBe(1);
  expect(saved.supportCount).toBe(0);

  await installAudioNodeEvidence(page);
  await sendPablo(page, 'compara o refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(160);
  const a = await audioNodeEvidence(page);
  expect(a.biquads.some((item) => item.type === 'peaking' && Math.abs(item.frequencyHz - 900) < 5)).toBe(true);
  expect(a.biquads.some((item) => item.type === 'peaking' && item.frequencyHz >= 80 && item.frequencyHz <= 260)).toBe(false);

  await resetAudioNodeEvidence(page);
  await panel.getByRole('button', { name: 'Ouvir B' }).click();
  await page.waitForTimeout(160);
  const b = await audioNodeEvidence(page);
  expect(b.biquads.some((item) => item.type === 'peaking' && Math.abs(item.frequencyHz - 900) < 5)).toBe(true);
  expect(b.biquads.some((item) => item.type === 'peaking' && item.frequencyHz >= 80 && item.frequencyHz <= 260)).toBe(true);

  await sendPablo(page, 'desfaz a limpeza no refrão');
  await expect(page.getByText(/Desfiz a limpeza vocal.*Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.map((event) => ({ source: event.source, kind: event.kind, frequencyHz: event.frequencyHz, gainDb: event.gainDb }));
  });
  expect(afterUndo.some((event) => event.source.startsWith('pablo_section_vocal_cleanup_'))).toBe(false);
  expect(afterUndo.some((event) => event.source === 'user_manual' && event.frequencyHz === 900)).toBe(true);
  expect(afterUndo.some((event) => event.source === 'pablo_section_vocal_deesser' && event.frequencyHz === 8600)).toBe(true);

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

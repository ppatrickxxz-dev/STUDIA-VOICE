import { stat } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

function vocalFlowWavFixture({ seconds = 1.85, sampleRate = 44100 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);

  let noise = 0x13579bdf;
  let breathState = 0;
  let s1 = 0;
  let s2 = 0;
  const clickPattern = [0.72, -0.56, 0.43, -0.31, 0.21, -0.13, 0.07];
  const clickStart = Math.floor(0.94 * sampleRate);
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

async function seedConfirmedSections(page) {
  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const core = await import('./core/src/project.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks[0];
    vocal.kind = 'recording';
    vocal.name = 'Voz principal';
    const support = core.createTrack({
      name: 'Instrumental',
      assetId: vocal.assetId,
      type: vocal.type,
      duration: vocal.duration,
      sampleRate: vocal.sampleRate,
      channels: vocal.channels,
      kind: 'audio',
    });
    project.tracks.push(support);
    project.activeTrackId = support.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 0.2, endSeconds: 1.25, source: 'user_manual', confidence: 1 });
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, { kind: 'chorus', startSeconds: 1.25, endSeconds: 1.78, source: 'user_manual', confidence: 1 });
    const first = project.arrangementMap.sections[0];
    vocal.regionAutomation.push({ id: `manual_gain:${first.id}`, kind: 'gain', startSeconds: 0.2, endSeconds: 1.25, gainDb: 0.8, confidence: 1, source: 'user_manual', enabled: true });
    await storage.saveProject(project);
  });
}

async function projectState(page, projectName = 'Gate Fluxo Completo') {
  return page.evaluate(async (name) => {
    const storage = await import('./storage.mjs');
    const request = indexedDB.open('pablovoice_mobile_v2', 3);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const projects = await new Promise((resolve, reject) => {
      const read = db.transaction('projects', 'readonly').objectStore('projects').getAll();
      read.onsuccess = () => resolve(read.result || []);
      read.onerror = () => reject(read.error);
    });
    db.close();
    const project = projects.find((candidate) => candidate.name === name) || await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const sectionIds = project.arrangementMap.sections.map((section) => section.id);
    const automation = (vocal?.regionAutomation || []).map((event) => ({ id: event.id, kind: event.kind, source: event.source, enabled: event.enabled }));
    return {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      revisions: project.revisions.length,
      trackCount: project.tracks.length,
      sectionIds,
      cleanupBySection: Object.fromEntries(sectionIds.map((sectionId) => [
        sectionId,
        automation.filter((event) => String(event.id).endsWith(`:${sectionId}`) && String(event.source).startsWith('pablo_section_vocal_cleanup_')).length,
      ])),
      automation,
    };
  }, projectName);
}

async function expectStableRevisions(page, expected) {
  await expect.poll(async () => (await projectState(page)).revisions).toBe(expected);
}

function unexpectedErrors(errors) {
  return errors.filter((message) =>
    !/favicon/i.test(message) &&
    !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message)
  );
}

test('WEB COMPLETE USER FLOW GATE: import, treat, continue, export mix and track, reload persisted treated project', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Fluxo Completo');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Gate Fluxo Completo' })).toBeVisible();
  await page.locator('#audio-picker').setInputFiles({ name: 'voz-fluxo-completo.wav', mimeType: 'audio/wav', buffer: vocalFlowWavFixture() });
  await expect(page.getByText('voz-fluxo-completo.wav').first()).toBeVisible();
  await seedConfirmedSections(page);

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

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'Pablo, trata minha voz inteira por prioridade top 1');
  await expect(page.getByText(/Tratei a voz por prioridade/i).last()).toBeVisible({ timeout: 20_000 });
  const afterFirst = await projectState(page);
  expect(afterFirst.cleanupBySection[afterFirst.sectionIds[0]]).toBeGreaterThan(0);
  expect(afterFirst.cleanupBySection[afterFirst.sectionIds[1]]).toBe(0);

  await sendPablo(page, 'Pablo, continua o tratamento vocal');
  await expect(page.getByText(/Continuei o tratamento vocal por prioridade/i).last()).toBeVisible({ timeout: 20_000 });
  const afterContinue = await projectState(page);
  expect(afterContinue.revisions).toBeGreaterThan(afterFirst.revisions);
  expect(afterContinue.cleanupBySection[afterContinue.sectionIds[0]]).toBe(afterFirst.cleanupBySection[afterFirst.sectionIds[0]]);
  expect(afterContinue.cleanupBySection[afterContinue.sectionIds[1]]).toBeGreaterThan(0);
  expect(afterContinue.automation.some((event) => event.source === 'user_manual')).toBe(true);
  expect(afterContinue.automation.some((event) => event.source === 'pablo_section_vocal_cleanup_deesser')).toBe(true);
  expect(afterContinue.automation.some((event) => event.source === 'pablo_section_vocal_cleanup_plosive')).toBe(true);
  expect(afterContinue.automation.some((event) => event.source === 'pablo_section_vocal_cleanup_click')).toBe(true);
  expect(afterContinue.automation.some((event) => event.source === 'pablo_section_vocal_cleanup_dynamics')).toBe(true);

  const revisionCountBeforeExport = afterContinue.revisions;
  const mixDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').first().click();
  const mixDownload = await mixDownloadPromise;
  expect(mixDownload.suggestedFilename()).toMatch(/^Gate_Fluxo_Completo-.*\.wav$/);
  const mixPath = await mixDownload.path();
  expect(mixPath).toBeTruthy();
  expect((await stat(mixPath)).size).toBeGreaterThan(44);
  await expectStableRevisions(page, revisionCountBeforeExport);

  await page.locator('[data-action="studio-tab"][data-value="export"]').click();
  const trackDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-track"]').first().click();
  const trackDownload = await trackDownloadPromise;
  expect(trackDownload.suggestedFilename()).toBe('Gate_Fluxo_Completo-Voz_principal-demo.wav');
  const trackPath = await trackDownload.path();
  expect(trackPath).toBeTruthy();
  expect((await stat(trackPath)).size).toBeGreaterThan(44);
  await expect(page.getByText(/Faixa processada exportada/)).toBeVisible();
  await expectStableRevisions(page, revisionCountBeforeExport);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText('Gate Fluxo Completo').first()).toBeVisible();
  await page.locator('[data-action="open-project"]').first().click();
  await expect(page.getByRole('heading', { name: 'Gate Fluxo Completo' })).toBeVisible();
  await expect(page.getByText('voz-fluxo-completo.wav').first()).toBeVisible();

  const afterReload = await projectState(page);
  expect(afterReload.revisions).toBe(revisionCountBeforeExport);
  expect(afterReload.cleanupBySection[afterReload.sectionIds[0]]).toBe(afterContinue.cleanupBySection[afterContinue.sectionIds[0]]);
  expect(afterReload.cleanupBySection[afterReload.sectionIds[1]]).toBe(afterContinue.cleanupBySection[afterContinue.sectionIds[1]]);
  expect(afterReload.automation).toEqual(afterContinue.automation);

  expect(unexpectedErrors(errors)).toEqual([]);
});

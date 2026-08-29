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
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[index])) * 32767), 44 + index * 2);
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
    vocal.kind = 'recording'; vocal.name = 'Voz principal'; project.activeTrackId = vocal.id;
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

async function restorationState(page) {
  return page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return {
      denoise: vocal.regionAutomation.filter((event) => event.source === 'pablo_section_vocal_cleanup_denoise'),
      dereverb: vocal.regionAutomation.filter((event) => event.source === 'pablo_section_vocal_cleanup_dereverb'),
      manual: vocal.regionAutomation.filter((event) => event.source === 'user_manual'),
      revisions: project.revisions.length,
    };
  });
}

async function waitForPabloIdle(page) {
  await expect(page.locator('[data-pablo-form]')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
}

async function waitForRestorationCount(page, key, minimum) {
  await expect.poll(async () => (await restorationState(page))[key].length, { timeout: 20_000 }).toBeGreaterThanOrEqual(minimum);
}

test('WEB SELECTIVE RESTORATION GATE: denoise and de-reverb apply, compare and undo independently without erasing each other', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Restauração Seletiva');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'selective-restoration.wav', mimeType: 'audio/wav', buffer: restorationWavFixture() });
  await expect(page.getByText('selective-restoration.wav').first()).toBeVisible();
  await seedVocalProject(page);
  await page.locator('[data-route="pablo"]').first().click();

  await sendPablo(page, 'Pablo, aplica só o denoise no refrão');
  await waitForRestorationCount(page, 'denoise', 1);
  await expect(page.getByText(/Apliquei só o denoise no Refrão/i).last()).toBeVisible({ timeout: 20_000 });
  let state = await restorationState(page);
  expect(state.dereverb).toHaveLength(0);
  expect(state.manual).toHaveLength(1);
  expect(state.denoise.every((event) => event.kind === 'vocal_denoise' && event.timbreProtected && event.reductionDb <= 5.5)).toBe(true);

  const firstDenoiseCount = state.denoise.length;
  await sendPablo(page, 'Pablo, aplica só o denoise no refrão');
  await waitForPabloIdle(page);
  state = await restorationState(page);
  expect(state.denoise).toHaveLength(firstDenoiseCount);

  await sendPablo(page, 'Pablo, faz só o de-reverb no refrão');
  await waitForRestorationCount(page, 'dereverb', 1);
  await expect(page.getByText(/Apliquei só o de-reverb no Refrão/i).last()).toBeVisible({ timeout: 20_000 });
  state = await restorationState(page);
  expect(state.denoise).toHaveLength(firstDenoiseCount);
  expect(state.manual).toHaveLength(1);
  expect(state.dereverb.every((event) => event.kind === 'vocal_dereverb' && event.timbreProtected && event.amount <= 0.2)).toBe(true);
  const firstDereverbCount = state.dereverb.length;

  await sendPablo(page, 'compara só o denoise no refrão');
  const denoisePanel = page.locator('[data-section-mix-ab][data-ab-mode="denoise"]').last();
  await expect(denoisePanel).toBeVisible({ timeout: 10_000 });
  await expect(denoisePanel).toContainText(/A\/B de denoise pronto/i);
  await denoisePanel.getByRole('button', { name: 'Ouvir A' }).click();
  await page.waitForTimeout(100);
  const abStatus = await page.evaluate(async () => {
    const runtime = await import('./section-mix-ab-runtime.mjs');
    return runtime.getSectionMixABStatus();
  });
  expect(abStatus.mode).toBe('denoise');
  expect(abStatus.removedEvents).toBe(firstDenoiseCount);
  state = await restorationState(page);
  expect(state.denoise).toHaveLength(firstDenoiseCount);
  expect(state.dereverb).toHaveLength(firstDereverbCount);
  expect(state.manual).toHaveLength(1);

  await denoisePanel.getByRole('button', { name: 'Prefiro A · desfazer' }).click();
  await expect(page.getByText(/Desfiz só o denoise.*Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  await waitForPabloIdle(page);
  state = await restorationState(page);
  expect(state.denoise).toHaveLength(0);
  expect(state.dereverb).toHaveLength(firstDereverbCount);
  expect(state.manual).toHaveLength(1);

  await sendPablo(page, 'Pablo, aplica só o denoise no refrão');
  await waitForRestorationCount(page, 'denoise', 1);
  state = await restorationState(page);
  expect(state.denoise.length).toBeGreaterThanOrEqual(1);
  expect(state.dereverb).toHaveLength(firstDereverbCount);

  await sendPablo(page, 'desfaz só o de-reverb no refrão');
  await expect(page.getByText(/Desfiz só o de-reverb.*Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  await waitForPabloIdle(page);
  state = await restorationState(page);
  expect(state.denoise.length).toBeGreaterThanOrEqual(1);
  expect(state.dereverb).toHaveLength(0);
  expect(state.manual).toHaveLength(1);

  await sendPablo(page, 'Pablo, faz só o de-reverb no refrão');
  await waitForRestorationCount(page, 'dereverb', 1);
  state = await restorationState(page);
  expect(state.denoise.length).toBeGreaterThanOrEqual(1);
  expect(state.dereverb.length).toBeGreaterThanOrEqual(1);

  await sendPablo(page, 'desfaz a limpeza no refrão');
  await expect(page.getByText(/Desfiz a limpeza vocal.*Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  await waitForPabloIdle(page);
  state = await restorationState(page);
  expect(state.denoise).toHaveLength(0);
  expect(state.dereverb).toHaveLength(0);
  expect(state.manual).toHaveLength(1);

  const unexpected = errors.filter((message) => !/favicon/i.test(message) && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

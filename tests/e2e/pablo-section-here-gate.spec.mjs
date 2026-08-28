import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.5, sampleRate = 44100, frequency = 260 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 2500, (samples - index) / 2500);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.24 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

async function sendPablo(page, message) {
  const form = page.locator('[data-pablo-form]');
  const input = form.locator('input[name="message"]');
  await input.fill(message);
  await form.getByRole('button', { name: 'Enviar' }).click();
}

test('WEB PABLO SECTION HERE GATE: contextual start and end use heard playhead without inventing structure', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Pablo Aqui');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'pablo-here.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('pablo-here.wav').first()).toBeVisible();

  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.locator('[data-pablo-form]')).toBeVisible();
  await sendPablo(page, 'marca o refrão aqui');
  await expect(page.getByText(/Não tenho um ponto recente e confirmado dessa música/i).last()).toBeVisible();

  const before = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.arrangementMap.sections.length;
  });
  expect(before).toBe(0);

  await page.locator('[data-route="studio"]').first().click();
  await expect(page.locator('[data-action="play"]')).toBeVisible();
  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(420);
  await expect(page.locator('#current-time')).not.toHaveText('0:00.0');
  await page.locator('[data-action="stop"]').click();
  await expect(page.locator('#current-time')).toHaveText('0:00.0');

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'Pablo, marca o refrão aqui');
  await expect(page.getByText(/Refrão marcado em .*timing manual confirmado/i).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/A seção foi salva como timing manual confirmado/i).last()).toBeVisible();

  const started = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const section = project.arrangementMap.sections[0] || null;
    return {
      sectionCount: project.arrangementMap.sections.length,
      section,
      revisionLabels: project.revisions.map((revision) => revision.label),
    };
  });

  expect(started.sectionCount).toBe(1);
  expect(started.section.kind).toBe('chorus');
  expect(started.section.startSeconds).toBeGreaterThan(0);
  expect(started.section.startSeconds).toBeLessThan(1.5);
  expect(started.section.endSeconds).toBeNull();
  expect(started.section.timingStatus).toBe('confirmed');
  expect(started.section.source).toBe('user_manual');
  expect(started.section.confidence).toBe(1);
  expect(started.revisionLabels.some((label) => /Refrão marcado na timeline/.test(label))).toBe(true);

  await page.locator('[data-route="studio"]').first().click();
  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(950);
  await expect(page.locator('#current-time')).not.toHaveText('0:00.0');
  await page.locator('[data-action="stop"]').click();

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'a ponte termina aqui');
  await expect(page.getByText(/Ainda não existe um início confirmado de ponte/i).last()).toBeVisible();

  const afterRejectedEnd = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.arrangementMap.sections.map((section) => ({ ...section }));
  });
  expect(afterRejectedEnd).toHaveLength(1);
  expect(afterRejectedEnd[0].startSeconds).toBe(started.section.startSeconds);
  expect(afterRejectedEnd[0].endSeconds).toBeNull();

  await sendPablo(page, 'o refrão termina aqui');
  await expect(page.getByText(/O fim foi salvo no mesmo timing manual confirmado da seção; o início foi preservado/i).last()).toBeVisible({ timeout: 10_000 });

  const ended = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const section = project.arrangementMap.sections[0] || null;
    return {
      sectionCount: project.arrangementMap.sections.length,
      section,
      revisionLabels: project.revisions.map((revision) => revision.label),
    };
  });
  expect(ended.sectionCount).toBe(1);
  expect(ended.section.kind).toBe('chorus');
  expect(ended.section.startSeconds).toBe(started.section.startSeconds);
  expect(ended.section.endSeconds).toBeGreaterThan(ended.section.startSeconds);
  expect(ended.section.endSeconds).toBeLessThan(1.5);
  expect(ended.section.timingStatus).toBe('confirmed');
  expect(ended.section.source).toBe('user_manual');
  expect(ended.section.confidence).toBe(1);
  expect(ended.revisionLabels.filter((label) => /Refrão marcado na timeline/.test(label)).length).toBeGreaterThanOrEqual(2);

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

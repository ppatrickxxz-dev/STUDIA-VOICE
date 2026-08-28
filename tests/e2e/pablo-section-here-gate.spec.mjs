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

test('WEB PABLO SECTION HERE GATE: here fails closed without playhead and marks the exact project after listening', async ({ page }) => {
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

  const saved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const section = project.arrangementMap.sections[0] || null;
    return {
      sectionCount: project.arrangementMap.sections.length,
      section,
      revisionLabels: project.revisions.map((revision) => revision.label),
    };
  });

  expect(saved.sectionCount).toBe(1);
  expect(saved.section.kind).toBe('chorus');
  expect(saved.section.startSeconds).toBeGreaterThan(0);
  expect(saved.section.startSeconds).toBeLessThan(1.5);
  expect(saved.section.timingStatus).toBe('confirmed');
  expect(saved.section.source).toBe('user_manual');
  expect(saved.section.confidence).toBe(1);
  expect(saved.revisionLabels.some((label) => /Refrão marcado na timeline/.test(label))).toBe(true);

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

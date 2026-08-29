import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.5, sampleRate = 44100, frequency = 330 } = {}) {
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
    const envelope = Math.min(1, index / 1800, (samples - index) / 1800);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.2 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

async function sendPablo(page, message) {
  const form = page.locator('[data-pablo-form]');
  await form.locator('input[name="message"]').fill(message);
  await form.getByRole('button', { name: 'Enviar' }).click();
}

async function seedChorus(page, endSeconds = null) {
  await page.evaluate(async ({ endSeconds }) => {
    const storage = await import('./storage.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus',
      startSeconds: 0.2,
      endSeconds,
      source: 'user_manual',
      confidence: 1,
    });
    await storage.saveProject(project);
  }, { endSeconds });
}

test('WEB PABLO SECTION AUDITION GATE: incomplete section is blocked and complete section plays only its confirmed range', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Audição Seção');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'section-audition.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('section-audition.wav').first()).toBeVisible();

  await seedChorus(page, null);
  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.locator('[data-pablo-form]')).toBeVisible();
  await sendPablo(page, 'toca o refrão');
  await expect(page.getByText(/fim ainda não foi marcado/i).last()).toBeVisible();
  const blocked = await page.evaluate(async () => (await import('./section-audition-runtime.mjs')).getSectionAuditionStatus());
  expect(blocked.playing).toBe(false);

  await seedChorus(page, 0.85);
  await sendPablo(page, 'Pablo, toca o refrão');
  await expect(page.getByText(/Tocando Refrão do início ao fim confirmado/i).last()).toBeVisible({ timeout: 10_000 });

  await page.waitForTimeout(100);
  const playing = await page.evaluate(async () => (await import('./section-audition-runtime.mjs')).getSectionAuditionStatus());
  expect(playing.playing).toBe(true);
  expect(playing.startSeconds).toBe(0.2);
  expect(playing.endSeconds).toBe(0.85);
  expect(playing.position).toBeGreaterThanOrEqual(0.2);
  expect(playing.position).toBeLessThan(0.85);

  await page.waitForTimeout(850);
  const ended = await page.evaluate(async () => (await import('./section-audition-runtime.mjs')).getSectionAuditionStatus());
  expect(ended.playing).toBe(false);
  expect(ended.position).toBe(0.85);

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.5, sampleRate = 44100, frequency = 220 } = {}) {
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
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / 3000, (samples - i) / 3000);
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.28 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return buffer;
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('WEB FUNCTIONAL GATE: project, audio, edit, preview, persistence and export', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();
  await expect(page.getByText('Sua ideia ganha som.').first()).toBeVisible();

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Web 2026');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Gate Web 2026' })).toBeVisible();

  await page.locator('#audio-picker').setInputFiles({ name: 'gate-tone.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('gate-tone.wav').first()).toBeVisible();
  await expect(page.locator('#waveform')).toBeVisible();
  await expect(page.locator('[data-action="export"]').first()).toBeEnabled();

  await setRange(page, 'input[data-control="trimStart"]', 0.1);
  await setRange(page, 'input[data-control="gain"]', 1.1);
  await expect(page.locator('[data-output="trimStart"]')).toContainText('0:00');
  await expect(page.locator('[data-output="gain"]')).toContainText('110%');

  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(350);
  await expect(page.locator('#current-time')).not.toHaveText('0:00.0');
  await page.locator('[data-action="stop"]').click();

  await page.locator('[data-action="studio-tab"][data-value="voice"]').click();
  const clean = page.locator('[data-action="effect"][data-value="clean"]');
  await expect(clean).toHaveClass(/on/);
  await clean.click();
  await expect(page.locator('[data-action="effect"][data-value="clean"]')).not.toHaveClass(/on/);
  await page.locator('[data-action="effect"][data-value="clean"]').click();
  await expect(page.locator('[data-action="effect"][data-value="clean"]')).toHaveClass(/on/);
  await page.locator('[data-action="ab"][data-value="original"]').click();
  await expect(page.locator('[data-action="ab"][data-value="original"]')).toHaveClass(/active/);
  await page.locator('[data-action="ab"][data-value="processed"]').click();
  await expect(page.locator('[data-action="ab"][data-value="processed"]')).toHaveClass(/active/);

  await page.locator('[data-action="save"]').click();
  await expect(page.getByText('Projeto salvo neste aparelho.')).toBeVisible();
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText('Gate Web 2026').first()).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText('Gate Web 2026').first()).toBeVisible();
  await page.locator('[data-action="open-project"]').first().click();
  await expect(page.getByRole('heading', { name: 'Gate Web 2026' })).toBeVisible();
  await expect(page.getByText('gate-tone.wav').first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Gate_Web_2026-.*\.wav$/);
  expect(await download.path()).toBeTruthy();

  await page.locator('[data-route="compose"]').first().click();
  await expect(page.getByText(/Composição|compor|Songwriting/i).first()).toBeVisible();
  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.getByText(/assistente local/i).first()).toBeVisible();
  expect(errors.filter((message) => !/favicon/i.test(message))).toEqual([]);
});

test('WEB RECORDING GATE: real MediaRecorder path creates a Studio track', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-action="record"]').first().click();
  await expect(page.getByRole('heading', { name: 'Gravando voz' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator('[data-action="stop-record"]').click();
  await expect(page.getByText('Gravação pronta no Studio.')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#waveform')).toBeVisible();
  await page.locator('[data-action="studio-tab"][data-value="voice"]').click();
  await expect(page.locator('[data-action="effect"][data-value="clean"]')).toBeVisible();
  expect(errors.filter((message) => !/favicon/i.test(message))).toEqual([]);
});

test('WEB MOBILE GATE: Android-sized viewport boots and navigates without overflow failure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();
  await page.locator('[data-route="studio"]').first().click();
  await expect(page.getByText(/Primeiro, uma ideia|Studio/i).first()).toBeVisible();
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 2);
  expect(errors.filter((message) => !/favicon/i.test(message))).toEqual([]);
});

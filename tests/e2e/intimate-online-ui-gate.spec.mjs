import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const evidenceDir = 'test-results/intimate-ui';
const companions = ['Star Spark', 'Nota Drop', 'Wave Ribbon', 'Vinyl Groove', 'EQ Bloom', 'Chime Lantern'];

async function shot(page, name) {
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true, animations: 'disabled' });
}

async function expectImageLoaded(locator) {
  await expect(locator).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => locator.evaluate((img) => Boolean(img.complete && img.naturalWidth > 0)), { timeout: 10_000 }).toBe(true);
}

test('INTIMATE UNIFIED UI GATE: one Studio survives connectivity changes without exposing executor modes', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-experience', 'intimate-recorder-v1');
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'adaptive');
  await expect(page.locator('.pv-health')).toHaveAttribute('data-pv-unified-health', 'ready');

  const stage = page.locator('#pv-intimate-home');
  await expect(stage).toBeVisible();
  const pablo = stage.locator('img.pv-intimate-pablo');
  await expect(pablo).toHaveAttribute('src', '/site/assets/pablo_fullbody.webp');
  await expectImageLoaded(pablo);
  for (const name of companions) await expect(stage.getByText(name, { exact: true })).toBeVisible();
  await expect(stage.locator('[data-pv-create="song"]')).toBeVisible();
  await expect(stage.locator('[data-pv-create="instrumental"]')).toBeVisible();
  await expect(stage.locator('[data-pv-network-copy]')).toHaveAttribute('data-pv-unified-copy', 'true');
  await shot(page, 'home-unified-desktop');

  await stage.locator('[data-pv-create="song"]').click();
  await expect(page.getByRole('heading', { name: 'Novo projeto' })).toBeVisible();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Unified Studio Gate');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });

  const form = page.locator('[data-song-create-form]');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'adaptive_unified');
  await expect(form).toHaveAttribute('data-pv-execution-policy', 'best_available');
  await expect(form.locator('[data-pv-unified-create-card]')).toBeVisible();
  await expect(form.locator('[data-pv-unified-create]')).toBeVisible();
  await expect(form.locator('[data-pv-unified-create]')).toContainText('Produzir música');
  await expect(form.locator('[data-song-create-button]').locator('xpath=ancestor::*[contains(@class,"pv-song-mode-card")][1]')).toBeHidden();
  await expect(form.locator('[data-song-create-hq]').locator('xpath=ancestor::*[contains(@class,"pv-song-mode-card")][1]')).toBeHidden();
  await expect(form.locator('[data-pv-kind="song"]')).toHaveClass(/active/);
  await expect(form.locator('.pv-intimate-advanced')).not.toHaveAttribute('open', '');

  await form.locator('input[name="brief"]').fill('R&B 2000s sensual, menos batestaca, baixo mais solto e refrão abrindo');
  await expect(form.locator('[data-pv-intent-copy]')).toContainText('refrão localizado');
  await expect(form.locator('[data-pv-intent-copy]')).toContainText('baixo');

  await form.locator('.pv-intimate-advanced > summary').click();
  await expect(form.locator('select[name="duration"] option[value="200"]')).toHaveText('3:20 · completa');
  await expect(form.locator('select[name="duration"] option[value="60"]')).toHaveText('1:00 · curta');
  await expect(form.locator('select[name="duration"] option[value="120"]')).toHaveText('2:00 · média');
  await shot(page, 'creator-unified-desktop');

  await form.locator('[data-pv-kind="instrumental"]').click();
  await expect(form.locator('input[name="instrumentalFirst"]')).toBeChecked();
  await expect(form.locator('[data-pv-unified-create]')).toContainText('Produzir instrumental');

  await context.setOffline(true);
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'adaptive');
  await expect(page.locator('.pv-health')).toHaveAttribute('data-pv-unified-health', 'ready');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'adaptive_unified');
  await expect(form.locator('[data-pv-unified-create-card]')).toBeVisible();
  await expect(form.locator('[data-pv-unified-create]')).toContainText('Produzir instrumental');
  await expect(form.locator('[data-song-create-button]').locator('xpath=ancestor::*[contains(@class,"pv-song-mode-card")][1]')).toBeHidden();
  await expect(form.locator('[data-song-create-hq]').locator('xpath=ancestor::*[contains(@class,"pv-song-mode-card")][1]')).toBeHidden();
  await shot(page, 'creator-same-studio-without-network');

  await context.setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'adaptive');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'adaptive_unified');

  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.locator('[data-pv-pablo-intimacy]')).toBeVisible();
  await page.locator('[data-pv-expression="listening"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-pv-pablo-state', 'listening');
  await expect(page.locator('[data-pv-pablo-intimacy]')).toContainText('OUVINDO');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-route="home"]').first().click();
  await expect(stage).toBeVisible();
  await expect(page.locator('.pv-health')).toHaveAttribute('data-pv-unified-health', 'ready');
  await shot(page, 'home-unified-mobile');

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

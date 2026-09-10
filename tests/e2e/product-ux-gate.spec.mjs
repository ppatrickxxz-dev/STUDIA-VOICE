import { test, expect } from '@playwright/test';

test('PRODUCT UX GATE: home is a creation-first music Studio, not a local launcher', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-ui', 'pablovoice_product_ui_v21', { timeout: 12_000 });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-route', 'home');

  const home = page.locator('#pv-product-home');
  await expect(home).toBeVisible();
  await expect(page.getByRole('heading', { name: /Crie a música/i })).toBeVisible();
  await expect(home.getByRole('heading', { name: 'O que você quer criar?' })).toBeVisible();
  await expect(home.locator('[data-pv-product-prompt]')).toBeVisible();
  await expect(home.locator('[data-pv-product-create="song"]')).toContainText('Criar música com IA');
  await expect(home.locator('[data-pv-product-create="instrumental"]')).toContainText('Criar instrumental');
  await expect(home).toContainText('Letra & direção');
  await expect(home).toContainText('Beat & instrumentos');
  await expect(home).toContainText('Arranjo & seções');
  await expect(home).toContainText('Voice Lab & mix');
  await expect(home).toContainText('Stems, master & export');

  await expect(page.locator('#pv-intimate-home')).toBeHidden();
  await expect(page.locator('.pv-home-grid')).toBeHidden();
  await expect(page.locator('.pv-cap-card')).toBeHidden();
  await expect(page.locator('[data-vnext-brain]')).toBeHidden();
  await expect(page.locator('[data-vnext-companion-dock]')).toBeHidden();

  const prompt = 'R&B 2000s sensual, baixo synth redondo, bateria solta e refrão grande';
  await home.locator('[data-pv-product-prompt]').fill(prompt);
  await home.locator('[data-pv-product-create="song"]').click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-song-create-form] input[name="brief"]')).toHaveValue(prompt);
  await expect(page.locator('[data-pv-unified-create]')).toBeVisible();
  await expect(page.locator('[data-pv-local-draft]')).toBeVisible();

  const nav = page.locator('.pv-nav').last();
  await nav.locator('[data-route="home"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#pv-product-home')).toBeVisible();
  await expect(page.locator('[data-pv-product-create="song"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

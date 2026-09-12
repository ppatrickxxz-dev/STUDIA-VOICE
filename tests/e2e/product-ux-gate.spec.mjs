import { test, expect } from '@playwright/test';

test('PRODUCT UX GATE: home is a creation-first unified high-quality music Studio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-ui', 'pablovoice_product_ui_v21', { timeout: 12_000 });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-route', 'home');
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('html')).toHaveAttribute('data-pv-access-mode', 'transparent-device');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'false');

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

  const renderedStyles = await page.evaluate(() => {
    const workspace = document.querySelector('.pv-product-workspace');
    const prompt = document.querySelector('[data-pv-product-prompt]');
    const primary = document.querySelector('[data-pv-product-create="song"]');
    if (!workspace || !prompt || !primary) return null;
    const workspaceStyle = getComputedStyle(workspace);
    const promptStyle = getComputedStyle(prompt);
    const primaryStyle = getComputedStyle(primary);
    return {
      workspaceDisplay: workspaceStyle.display,
      workspaceBackgroundImage: workspaceStyle.backgroundImage,
      workspaceRadius: parseFloat(workspaceStyle.borderRadius || '0'),
      promptBackground: promptStyle.backgroundColor,
      promptRadius: parseFloat(promptStyle.borderRadius || '0'),
      primaryDisplay: primaryStyle.display,
      primaryBackgroundImage: primaryStyle.backgroundImage,
      primaryRadius: parseFloat(primaryStyle.borderRadius || '0'),
    };
  });
  expect(renderedStyles).not.toBeNull();
  expect(renderedStyles.workspaceDisplay).toBe('grid');
  expect(renderedStyles.workspaceBackgroundImage).toContain('linear-gradient');
  expect(renderedStyles.workspaceRadius).toBeGreaterThanOrEqual(18);
  expect(renderedStyles.promptBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(renderedStyles.promptRadius).toBeGreaterThanOrEqual(18);
  expect(renderedStyles.primaryDisplay).toBe('grid');
  expect(renderedStyles.primaryBackgroundImage).toContain('linear-gradient');
  expect(renderedStyles.primaryRadius).toBeGreaterThanOrEqual(16);

  const prompt = 'R&B 2000s sensual, baixo synth redondo, bateria solta e refrão grande';
  await home.locator('[data-pv-product-prompt]').fill(prompt);
  await home.locator('[data-pv-product-create="song"]').click();
  const form = page.locator('[data-song-create-form]');
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  await expect(form.locator('input[name="brief"]')).toHaveValue(prompt);
  await expect(form).toHaveAttribute('data-pv-network-policy', 'online_only');
  await expect(form).toHaveAttribute('data-pv-execution-policy', 'high_quality_only');
  await expect(form.locator('[data-pv-unified-create]')).toBeVisible();
  await expect(form.locator('[data-pv-unified-create]')).toContainText('alta qualidade');
  await expect(form.locator('[data-pv-local-draft]')).toHaveCount(0);
  await expect(form.locator('[data-song-create-button]')).toBeHidden();
  await expect(page.locator('#pv-remote-pairing')).toHaveCount(0);
  await expect(page.locator('[data-remote-pair-form]')).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);

  const nav = page.locator('.pv-nav').last();
  await nav.locator('[data-route="home"]').click();
  await expect(page.locator('#pv-product-home')).toBeVisible();
  await expect(page.locator('[data-pv-product-create="song"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

import { test, expect } from '@playwright/test';

test('PRODUCT UX GATE: home is a creation-first unified high-quality music Studio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-ui', 'pablovoice_product_ui_v31_music_first', { timeout: 12_000 });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-route', 'home');
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('html')).toHaveAttribute('data-pv-access-mode', 'transparent-device');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'false');

  const home = page.locator('#pv-product-home');
  await expect(home).toBeVisible();
  await expect(page.getByRole('heading', { name: /Faça uma música/i }).first()).toBeVisible();
  await expect(home.getByRole('heading', { name: 'Descreva o som que você quer.' })).toBeVisible();
  await expect(home.locator('[data-pv-product-prompt]')).toBeVisible();
  await expect(home.locator('[data-pv-product-create="song"]')).toContainText('Criar música');
  await expect(home.locator('[data-pv-product-create="instrumental"]')).toContainText('Criar instrumental');
  await expect(home.getByRole('button', { name: /Novo projeto vazio/i })).toBeVisible();
  await expect(home).toContainText('PROJETOS');
  await expect(home).not.toContainText('Voice Lab & mix');
  await expect(home).not.toContainText('Beat & instrumentos');

  await expect(page.locator('#pv-intimate-home')).toBeHidden();
  await expect(page.locator('.pv-home-grid')).toBeHidden();
  await expect(page.locator('.pv-cap-card')).toBeHidden();
  await expect(page.locator('[data-vnext-brain]')).toBeHidden();
  await expect(page.locator('[data-vnext-companion-dock]')).toBeHidden();
  await expect(page.locator('[data-vnext-visualizer]')).toBeHidden();

  const renderedStyles = await page.evaluate(() => {
    const workspace = document.querySelector('.pv-product-create-card-v31');
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
  expect(renderedStyles.promptRadius).toBeGreaterThanOrEqual(10);
  expect(renderedStyles.primaryDisplay).toBe('grid');
  expect(renderedStyles.primaryBackgroundImage).toContain('linear-gradient');
  expect(renderedStyles.primaryRadius).toBeGreaterThanOrEqual(10);

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
  await expect(page.locator('[data-pv-creation-flow]')).toBeVisible();

  const nav = page.locator('.pv-vnext-nav.pv-nav');
  await nav.locator('[data-route="home"]').click();
  await expect(page.locator('#pv-product-home')).toBeVisible();
  await expect(page.locator('[data-pv-product-create="song"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('PRODUCT STUDIO CUT GATE: Studio starts with the song-finishing controls, not a wall of labs', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('#pv-product-home').getByRole('button', { name: 'Novo projeto vazio' }).click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Studio Cut Gate');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('.pv-vnext-nav.pv-nav [data-route="studio"]').click();

  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-cut', 'song_completion_v2');
  await expect(page.locator('main')).toHaveAttribute('data-pv-studio-first-cut', 'true');
  await expect(page.locator('[data-pv-studio-core-action="import"]')).toBeVisible();
  await expect(page.locator('[data-pv-studio-core-action="record"]')).toBeVisible();
  await expect(page.locator('[data-pv-studio-core-action="save"]')).toBeVisible();
  await expect(page.locator('[data-pv-studio-core-action="export"]')).toBeVisible();
  await expect(page.getByText('Voice Lab', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-vnext-brain]')).toBeHidden();
  await expect(page.locator('[data-vnext-companion-dock]')).toBeHidden();
});

test('STUDIA MUSIC-FIRST UI GATE: every primary screen stays inside one canonical four-route shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const html = page.locator('html');
  const shell = page.locator('[data-pv-studia-shell="music-first"]');
  const nav = page.locator('[data-pv-studia-nav="music-first"]');
  await expect(html).toHaveAttribute('data-pv-studia-ui', 'studia_voice_usability_v1', { timeout: 12_000 });
  await expect(shell).toHaveCount(1);
  await expect(shell).toBeVisible();
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(nav).toHaveAttribute('data-pv-studia-primary-order', 'home,studio,projects,pablo');
  await expect(page.locator('.pv-legacy-nav')).toBeHidden();
  await expect(page.locator('.pv-legacy-nav')).toHaveAttribute('aria-hidden', 'true');
  await expect(shell.locator('[data-pv-studia-brand]')).toContainText('STUDIA VOICE');

  await expect(nav.getByText('Criar', { exact: true })).toBeVisible();
  await expect(nav.getByText('Studio', { exact: true })).toBeVisible();
  await expect(nav.getByText('Projetos', { exact: true })).toBeVisible();
  await expect(nav.getByText('Pablo', { exact: true })).toBeVisible();
  await expect(nav.locator('[data-vnext-route-command="create"]')).toBeHidden();
  await expect(nav.locator('[data-vnext-route-command="lyrics"]')).toBeHidden();
  await expect(nav.locator('[data-pv-studia-tools="true"]')).toHaveCount(0);

  await nav.locator('[data-route="home"]').click();
  await expect(html).toHaveAttribute('data-pv-studia-screen', 'home');
  await expect(page.locator('#pv-product-home')).toBeVisible();
  await expect(page.locator('#pv-intimate-home')).toBeHidden();

  await page.locator('#pv-product-home [data-pv-product-create="song"]').click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  await expect(html).toHaveAttribute('data-pv-studia-screen', 'compose');
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(page.locator('[data-vnext-brain]')).toBeHidden();
  await expect(page.locator('[data-vnext-companion-dock]')).toBeHidden();
  await expect(page.locator('[data-vnext-visualizer]')).toBeHidden();

  await nav.locator('[data-route="studio"]').click();
  await expect(html).toHaveAttribute('data-pv-studia-screen', 'studio');
  await expect(page.locator('[data-pv-studio-core-action="record"]')).toBeVisible();
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();

  await nav.locator('[data-route="projects"]').click();
  await expect(page.getByRole('heading', { name: /Projetos/i })).toBeVisible();
  await expect(shell).toBeVisible();

  await nav.locator('[data-route="pablo"]').click();
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();

  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desktopOverflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await nav.locator('[data-route="home"]').click();
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(mobileOverflow).toBeLessThanOrEqual(1);
});

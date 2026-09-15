import { test, expect } from '@playwright/test';

test('PRODUCT UX GATE: home is a creation-first unified high-quality music Studio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-ui', 'pablovoice_product_ui_v30', { timeout: 12_000 });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-route', 'home');
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('html')).toHaveAttribute('data-pv-access-mode', 'transparent-device');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'false');

  const home = page.locator('#pv-product-home');
  await expect(home).toBeVisible();
  await expect(page.getByRole('heading', { name: /Crie a música primeiro/i })).toBeVisible();
  await expect(home.getByRole('heading', { name: 'Como ela deve soar?' })).toBeVisible();
  await expect(home.locator('[data-pv-product-prompt]')).toBeVisible();
  await expect(home.locator('[data-pv-product-create="song"]')).toContainText('Música com voz');
  await expect(home.locator('[data-pv-product-create="song"]')).toContainText('voz cantada');
  await expect(home.locator('[data-pv-product-create="instrumental"]')).toContainText('Instrumental');
  await expect(home.getByRole('button', { name: /Novo projeto vazio/i })).toBeVisible();
  await expect(home).toContainText('SUAS MÚSICAS');
  await expect(home).toContainText('Continuar produzindo');
  await expect(home).not.toContainText('Voice Lab & mix');
  await expect(home).not.toContainText('Beat & instrumentos');

  await expect(page.locator('#pv-intimate-home')).toBeHidden();
  await expect(page.locator('.pv-home-grid')).toBeHidden();
  await expect(page.locator('.pv-cap-card')).toBeHidden();
  await expect(page.locator('[data-vnext-brain]')).toBeHidden();
  await expect(page.locator('[data-vnext-companion-dock]')).toBeHidden();

  const renderedStyles = await page.evaluate(() => {
    const workspace = document.querySelector('.pv-product-create-card-v30');
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
  expect(renderedStyles.promptRadius).toBeGreaterThanOrEqual(16);
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

test('PRODUCT STUDIO CUT GATE: Studio starts with the song-finishing controls, not a wall of labs', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Studio Cut Gate');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('.pv-nav [data-route="studio"]').last().click();

  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-cut', 'song_completion_v1');
  await expect(page.locator('main')).toHaveAttribute('data-pv-studio-first-cut', 'true');
  await expect(page.locator('[data-pv-studio-core-action="import"]')).toBeVisible();
  await expect(page.locator('[data-pv-studio-core-action="record"]')).toBeVisible();
  await expect(page.locator('[data-pv-studio-core-action="save"]')).toBeVisible();
  await expect(page.locator('[data-pv-studio-core-action="export"]')).toBeVisible();
  await expect(page.getByText('Voice Lab', { exact: true })).toHaveCount(0);
});

test('STUDIA SINGLE UI GATE: every primary screen stays inside one canonical Studia Voice shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const html = page.locator('html');
  const shell = page.locator('[data-pv-studia-shell="canonical"]');
  const nav = page.locator('[data-pv-studia-nav="canonical"]');
  await expect(html).toHaveAttribute('data-pv-studia-ui', 'studia_voice_single_ui_v1', { timeout: 12_000 });
  await expect(shell).toHaveCount(1);
  await expect(shell).toBeVisible();
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(page.locator('.pv-legacy-nav')).toBeHidden();
  await expect(page.locator('.pv-legacy-nav')).toHaveAttribute('aria-hidden', 'true');
  await expect(shell.locator('[data-pv-studia-brand]')).toContainText('STUDIA VOICE · MUSIC STUDIO');

  await expect(nav.getByText('Início', { exact: true })).toBeVisible();
  await expect(nav.getByText('Criar', { exact: true })).toBeVisible();
  await expect(nav.getByText('Letras', { exact: true })).toBeVisible();
  await expect(nav.getByText('Studio', { exact: true })).toBeVisible();
  await expect(nav.getByText('Projetos', { exact: true })).toBeVisible();
  await expect(nav.getByText('Pablo Brain', { exact: true })).toBeVisible();

  const tools = nav.locator('[data-pv-studia-tools="true"]');
  await expect(tools).toBeVisible();
  await tools.locator('summary').click();
  for (const command of ['beat', 'instrument', 'vocal', 'record', 'mixer', 'arrangement', 'master', 'export']) {
    await expect(tools.locator(`[data-vnext-command="${command}"]`)).toBeVisible();
  }

  await nav.locator('[data-route="home"]').click();
  await expect(html).toHaveAttribute('data-pv-studia-screen', 'home');
  await expect(page.locator('#pv-product-home')).toBeVisible();
  await expect(page.locator('#pv-intimate-home')).toBeHidden();

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Studia Canon Gate');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();

  const create = nav.locator('[data-vnext-route-command="create"]');
  await create.click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();

  await nav.locator('[data-route="studio"]').click();
  await expect(page.locator('.pv-transport-card')).toBeVisible();
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
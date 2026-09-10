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

test('VNEXT UNIFIED UI GATE: one Studio keeps canonical Pablo and Companions across connectivity changes', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'adaptive');
  await expect(page.locator('html')).toHaveAttribute('data-pv-vnext-boot', 'ready', { timeout: 12_000 });

  const shell = page.locator('.pv-vnext-shell');
  const nav = shell.locator('.pv-vnext-nav.pv-nav');
  const brain = shell.locator('[data-vnext-brain]');
  const dock = shell.locator('[data-vnext-companion-dock]');
  const visualizer = shell.locator('[data-vnext-visualizer]');
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(brain).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(visualizer).toBeVisible();

  const pablo = brain.locator('img[src="/site/assets/pablo_fullbody.webp"]');
  await expectImageLoaded(pablo);
  for (const name of companions) await expect(dock.getByText(name, { exact: true })).toBeVisible();
  await expect(visualizer).toHaveAttribute('data-vnext-reactive', 'music-graph');
  await expect(nav.locator('[data-route="home"]')).toBeVisible();
  await expect(nav.locator('[data-vnext-route-command="create"]')).toBeVisible();
  await expect(nav.locator('[data-vnext-route-command="lyrics"]')).toBeVisible();
  await expect(nav.locator('[data-route="studio"]')).toBeVisible();
  await expect(nav.locator('[data-route="projects"]')).toBeVisible();
  await expect(nav.locator('[data-route="pablo"]')).toBeVisible();
  await shot(page, 'home-vnext-unified-desktop');

  await page.locator('[data-action="new-project"]').first().click();
  await expect(page.getByRole('heading', { name: 'Novo projeto' })).toBeVisible();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Unified Studio Gate');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Unified Studio Gate' })).toBeVisible();

  await nav.locator('[data-vnext-route-command="create"]').click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  const form = page.locator('[data-song-create-form]');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'quality_first');
  await expect(form).toHaveAttribute('data-pv-execution-policy', 'explicit_quality_or_draft');
  await expect(form.locator('[data-pv-unified-create-card]')).toBeVisible();
  await expect(form.locator('[data-pv-unified-create]')).toBeVisible();
  await expect(form.locator('[data-pv-unified-create]')).toContainText('alta qualidade');
  await expect(form.locator('[data-pv-local-draft]')).toBeVisible();
  await expect(form.locator('[data-song-create-button]').locator('xpath=ancestor::*[contains(@class,"pv-song-mode-card")][1]')).toBeHidden();
  await expect(form.locator('[data-song-create-hq]').locator('xpath=ancestor::*[contains(@class,"pv-song-mode-card")][1]')).toBeHidden();
  await expect(form.locator('[data-pv-kind="song"]')).toHaveClass(/active/);
  await expect(form.locator('.pv-intimate-advanced')).not.toHaveAttribute('open', '');

  const ownerAccess = page.locator('#pv-remote-pairing');
  await expect(ownerAccess).toBeVisible({ timeout: 10_000 });
  await expect(ownerAccess).toContainText('Acesso do proprietário');
  await expect(ownerAccess.getByRole('button', { name: 'Liberar meu estúdio' })).toBeVisible();

  await form.locator('input[name="brief"]').fill('R&B 2000s sensual, menos batestaca, baixo mais solto e refrão abrindo');
  await expect(form.locator('[data-pv-intent-copy]')).toContainText('refrão localizado');
  await expect(form.locator('[data-pv-intent-copy]')).toContainText('baixo');
  await form.locator('.pv-intimate-advanced > summary').click();
  await expect(form.locator('select[name="duration"] option[value="200"]')).toHaveText('3:20 · completa');
  await shot(page, 'creator-vnext-quality-first-desktop');

  await form.locator('[data-pv-kind="instrumental"]').click();
  await expect(form.locator('input[name="instrumentalFirst"]')).toBeChecked();
  await expect(form.locator('[data-pv-unified-create]')).toContainText('instrumental em alta qualidade');

  await context.setOffline(true);
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'adaptive');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'quality_first');
  await expect(form.locator('[data-pv-unified-create-card]')).toBeVisible();
  await expect(form.locator('[data-pv-local-draft]')).toBeVisible();
  await expect(shell.locator('[data-vnext-network]')).toHaveText('STUDIO');
  await expect(shell.locator('[data-vnext-online]')).toHaveText('STUDIO');
  await shot(page, 'creator-same-vnext-studio-without-network');

  await context.setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'quality_first');

  await nav.locator('[data-route="pablo"]').click();
  await expect(page.locator('[data-pv-pablo-intimacy]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-pv-expression="listening"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-pv-pablo-state', 'listening');
  await expect(page.locator('[data-pv-pablo-intimacy]')).toContainText('OUVINDO');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNav = page.locator('.pv-vnext-nav.pv-nav');
  await mobileNav.locator('[data-route="home"]').click();
  await expect(page.locator('.pv-vnext-shell')).toBeVisible();
  await expect(page.locator('[data-vnext-visualizer]')).toBeVisible();
  await expect(mobileNav).toBeVisible();
  await shot(page, 'home-vnext-unified-mobile');

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

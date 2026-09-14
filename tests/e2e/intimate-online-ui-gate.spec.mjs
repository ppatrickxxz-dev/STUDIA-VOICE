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

test('VNEXT UNIFIED UI GATE: Pablo art stays canonical while Creator remains one product online and offline', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('html')).toHaveAttribute('data-pv-access-mode', 'transparent-device');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-pv-vnext-boot', 'ready', { timeout: 12_000 });
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-ui', 'pablovoice_product_ui_v21', { timeout: 12_000 });

  const shell = page.locator('.pv-vnext-shell');
  const nav = shell.locator('.pv-vnext-nav.pv-nav');
  const brain = shell.locator('[data-vnext-brain]');
  const dock = shell.locator('[data-vnext-companion-dock]');
  const visualizer = shell.locator('[data-vnext-visualizer]');
  await expect(shell).toBeVisible();
  await expect(nav).toBeVisible();
  await expect(page.locator('#pv-product-home')).toBeVisible();
  await expect(brain).toBeHidden();
  await expect(dock).toBeHidden();
  await expect(visualizer).toBeHidden();
  await expect(nav.locator('[data-route="home"]')).toBeVisible();
  await expect(nav.locator('[data-vnext-route-command="create"]')).toBeVisible();
  await expect(nav.locator('[data-vnext-route-command="lyrics"]')).toBeVisible();
  await expect(nav.locator('[data-route="studio"]')).toBeVisible();
  await expect(nav.locator('[data-route="projects"]')).toBeVisible();
  await expect(nav.locator('[data-route="pablo"]')).toBeVisible();
  await shot(page, 'home-product-unified-desktop');

  await page.locator('[data-action="new-project"]').first().click();
  await expect(page.getByRole('heading', { name: 'Novo projeto' })).toBeVisible();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Unified Studio Gate');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Unified Studio Gate' })).toBeVisible();

  await nav.locator('[data-vnext-route-command="create"]').click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  await expect(brain).toBeVisible();
  await expect(dock).toBeVisible();
  await expect(visualizer).toBeVisible();
  const pablo = brain.locator('img[src="/site/assets/pablo_fullbody.webp"]');
  await expectImageLoaded(pablo);
  for (const name of companions) await expect(dock.getByText(name, { exact: true })).toBeVisible();
  await expect(visualizer).toHaveAttribute('data-vnext-reactive', 'music-graph');

  const form = page.locator('[data-song-create-form]');
  await expect(form.locator('[data-song-create-hq]')).toBeVisible();
  await expect(form.locator('[data-song-create-hq]')).toContainText('Criar 2 versões');
  await expect(form.locator('[data-pv-unified-create-card]')).toHaveCount(0);
  await expect(form.locator('[data-pv-unified-create]')).toHaveCount(0);
  await expect(form.locator('[data-pv-local-draft]')).toHaveCount(0);
  await expect(form.locator('[data-pv-kind="song"]')).toHaveClass(/active/);
  await expect(form.locator('.pv-create-adjustments')).not.toHaveAttribute('open', '');

  await expect(page.locator('#pv-remote-pairing')).toHaveCount(0);
  await expect(page.locator('[data-remote-pair-form]')).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.getByText(/Acesso do proprietário|Liberar meu estúdio|código de ativação/i)).toHaveCount(0);

  await page.locator('#lyrics').fill('[VERSE 1 — 8 bars]\nEu vejo você chegar\n\n[CHORUS — 8 bars]\nTudo isso é tão eu');
  await form.locator('textarea[name="brief"]').fill('R&B 2000s sensual, menos batestaca, baixo mais solto e refrão abrindo');
  await form.locator('.pv-create-adjustments > summary').click();
  await expect(form.locator('select[name="duration"] option[value="200"]')).toHaveText('3:20');
  await shot(page, 'creator-product-unified-online-desktop');

  await form.locator('[data-pv-kind="instrumental"]').click();
  await expect(form.locator('input[name="instrumentalFirst"]')).toBeChecked();
  await expect(form.locator('[data-pv-kind="instrumental"]')).toHaveClass(/active/);
  await expect(form.locator('[data-song-create-hq]')).toContainText('Criar 2 versões');

  await context.setOffline(true);
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'offline');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'true');
  await expect(form.locator('[data-song-create-hq]')).toBeVisible();
  await form.locator('[data-song-create-hq]').click();
  await expect(page.locator('#pv-song-create-status')).toContainText('pedido ficou salvo', { timeout: 10_000 });
  await expect(page.locator('#pv-song-creator')).toBeVisible();
  await shot(page, 'creator-unified-studio-offline-queued');

  await context.setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'false');
  await expect(form).toBeVisible();

  await nav.locator('[data-route="pablo"]').click();
  await expect(page.locator('[data-pv-pablo-intimacy]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-pv-expression="listening"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-pv-pablo-state', 'listening');
  await expect(page.locator('[data-pv-pablo-intimacy]')).toContainText('OUVINDO');

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNav = page.locator('.pv-vnext-nav.pv-nav');
  await mobileNav.locator('[data-route="home"]').click();
  await expect(page.locator('.pv-vnext-shell')).toBeVisible();
  await expect(page.locator('#pv-product-home')).toBeVisible();
  await expect(page.locator('[data-vnext-visualizer]')).toBeHidden();
  await expect(mobileNav).toBeVisible();
  await shot(page, 'home-product-unified-mobile');

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

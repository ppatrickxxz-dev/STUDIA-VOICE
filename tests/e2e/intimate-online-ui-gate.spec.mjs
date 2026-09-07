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

test('INTIMATE ONLINE UI GATE: canonical Pablo is alive, companions work and network chooses production mode', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-experience', 'intimate-recorder-v1');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('.pv-health')).toContainText('ONLINE · FULL');

  const stage = page.locator('#pv-intimate-home');
  await expect(stage).toBeVisible();
  const pablo = stage.locator('img.pv-intimate-pablo');
  await expect(pablo).toHaveAttribute('src', '/site/assets/pablo_fullbody.webp');
  await expectImageLoaded(pablo);
  for (const name of companions) await expect(stage.getByText(name, { exact: true })).toBeVisible();
  await expect(stage.locator('[data-pv-create="song"]')).toBeVisible();
  await expect(stage.locator('[data-pv-create="instrumental"]')).toBeVisible();
  await shot(page, 'home-online-desktop');

  // Explicit Create Music is creator-first. Generic New Project remains Studio-first
  // elsewhere, preserving the professional project workflow.
  await stage.locator('[data-pv-create="song"]').click();
  await expect(page.getByRole('heading', { name: 'Novo projeto' })).toBeVisible();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Intimate Gate');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });

  const form = page.locator('[data-song-create-form]');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'online_full');
  await expect(form.locator('.pv-online-primary-card')).toBeVisible();
  await expect(form.locator('.pv-local-fallback-card')).toBeHidden();
  await expect(form.locator('[data-pv-kind="song"]')).toHaveClass(/active/);
  await expect(form.locator('.pv-intimate-advanced')).not.toHaveAttribute('open', '');
  await form.locator('input[name="brief"]').fill('R&B 2000s sensual, menos batestaca, baixo mais solto e refrão abrindo');
  await expect(form.locator('[data-pv-intent-copy]')).toContainText('refrão localizado');
  await expect(form.locator('[data-pv-intent-copy]')).toContainText('baixo');
  await shot(page, 'creator-online-desktop');

  // Instrumental is a creative goal, not a separate app/mode architecture.
  await form.locator('[data-pv-kind="instrumental"]').click();
  await expect(form.locator('input[name="instrumentalFirst"]')).toBeChecked();
  await expect(form.locator('[data-song-create-hq]')).toContainText('Produzir instrumental');

  // Network loss changes the same Creator to the local engine automatically.
  await context.setOffline(true);
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'offline');
  await expect(page.locator('.pv-health')).toContainText('OFFLINE · LOCAL');
  await expect(form).toHaveAttribute('data-pv-network-policy', 'offline_local');
  await expect(form.locator('.pv-local-fallback-card')).toBeVisible();
  await expect(form.locator('.pv-online-primary-card')).toBeHidden();
  await shot(page, 'creator-offline-fallback-desktop');
  await context.setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');

  // Pablo exposes the requested intimate state vocabulary without changing the
  // canonical character asset.
  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.locator('[data-pv-pablo-intimacy]')).toBeVisible();
  await page.locator('[data-pv-expression="listening"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-pv-pablo-state', 'listening');
  await expect(page.locator('[data-pv-pablo-intimacy]')).toContainText('OUVINDO');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-route="home"]').first().click();
  await expect(stage).toBeVisible();
  await shot(page, 'home-mobile');

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

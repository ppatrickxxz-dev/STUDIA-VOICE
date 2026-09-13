import { test, expect } from '@playwright/test';

function unexpectedErrors(errors) {
  return errors.filter((message) =>
    !/favicon/i.test(message) &&
    !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message)
  );
}

test('SONG CREATION GATE: one song-first Studio keeps the same Creator online and offline', async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-mode', 'unified');
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('html')).toHaveAttribute('data-pv-access-mode', 'transparent-device');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-pv-vnext-boot', 'ready', { timeout: 10_000 });
  await expect(page.locator('#pv-remote-pairing')).toHaveCount(0);
  await expect(page.locator('[data-remote-pair-form]')).toHaveCount(0);

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Criação Musical');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Gate Criação Musical' })).toBeVisible();

  await page.locator('.pv-vnext-nav [data-vnext-route-command="create"]').click();
  await expect(page.locator('#lyrics')).toBeVisible();
  await page.locator('#lyrics').fill('[VERSE 1 — 8 bars]\nQuando a cidade apaga eu vejo você\nChega mais perto, deixa acontecer\n\n[CHORUS — 8 bars]\nHoje eu não prometo o que vem depois\nQuando amanhecer, amanhã a gente vê');

  const form = page.locator('[data-song-create-form]');
  await expect(form).toBeVisible({ timeout: 10_000 });
  await expect(form.locator('[data-pv-kind="song"]')).toHaveClass(/active/);
  await expect(form.locator('[data-song-create-hq]')).toBeVisible();
  await expect(form.locator('[data-song-create-hq]')).toContainText('Criar 2 versões');
  await expect(form.locator('[data-pv-unified-create]')).toHaveCount(0);
  await expect(form.locator('[data-pv-local-draft]')).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.getByText(/Liberar meu estúdio/i)).toHaveCount(0);

  await form.locator('textarea[name="brief"]').fill('Pop R&B noturno, synths suaves, grave redondo e refrão aberto');
  await form.locator('.pv-create-adjustments > summary').click();
  await form.locator('select[name="genre"]').selectOption('rnb');
  await form.locator('input[name="bpm"]').fill('112');
  await form.locator('select[name="duration"]').selectOption('200');
  await form.locator('select[name="key"]').selectOption('A');
  await form.locator('input[name="mood"]').fill('íntimo, elegante, noturno');

  await context.setOffline(true);
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'offline');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'true');
  await expect(form.locator('[data-song-create-hq]')).toBeVisible();
  await form.locator('[data-song-create-hq]').click();
  await expect(page.locator('#pv-song-create-status')).toContainText('pedido ficou salvo', { timeout: 10_000 });
  await expect(page.locator('#pv-song-creator')).toBeVisible();

  await context.setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('html')).toHaveAttribute('data-pv-offline-mode', 'false');
  await expect(page.locator('#pv-song-create-status')).toContainText('pedido(s) salvo(s)', { timeout: 10_000 });

  expect(unexpectedErrors(errors)).toEqual([]);
});

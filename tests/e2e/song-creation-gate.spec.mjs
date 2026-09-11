import { test, expect } from '@playwright/test';

function unexpectedErrors(errors) {
  return errors.filter((message) =>
    !/favicon/i.test(message) &&
    !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message)
  );
}

test('SONG CREATION GATE: one connected high-quality Studio with no login or offline draft mode', async ({ page, context }) => {
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
  await page.locator('#lyrics').fill('Quando a cidade apaga eu vejo você\nChega mais perto, deixa acontecer\nHoje eu não prometo o que vem depois\nQuando amanhecer, amanhã a gente vê');

  const form = page.locator('[data-song-create-form]');
  await expect(form).toBeVisible({ timeout: 10_000 });
  await expect(form).toHaveAttribute('data-pv-network-policy', 'online_only');
  await expect(form).toHaveAttribute('data-pv-execution-policy', 'high_quality_only');
  await expect(form.locator('[data-pv-unified-create]')).toContainText('alta qualidade');
  await expect(form.locator('[data-pv-local-draft]')).toHaveCount(0);
  await expect(form.locator('[data-song-create-button]')).toBeHidden();
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.getByText(/Liberar meu estúdio/i)).toHaveCount(0);

  await form.locator('input[name="brief"]').fill('Pop R&B noturno, synths suaves, grave redondo e refrão aberto');
  await form.locator('.pv-intimate-advanced > summary').click();
  await form.locator('select[name="genre"]').selectOption('rnb');
  await form.locator('input[name="bpm"]').fill('112');
  await form.locator('select[name="duration"]').selectOption('60');
  await form.locator('select[name="key"]').selectOption('A');
  await form.locator('input[name="mood"]').fill('íntimo, elegante, noturno');

  await context.setOffline(true);
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(form.locator('[data-pv-local-draft]')).toHaveCount(0);
  await form.locator('[data-pv-unified-create]').click();
  await expect(page.locator('#pv-song-create-status')).toContainText('precisa de conexão', { timeout: 10_000 });
  await expect(page.locator('#pv-remote-pairing')).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-pv-network-mode', 'online');
  await expect(page.locator('.pv-health')).not.toContainText(/OFFLINE|LOCAL/i);
  const networkCopy = page.locator('[data-pv-network-copy]');
  for (let index = 0; index < await networkCopy.count(); index += 1) {
    await expect(networkCopy.nth(index)).not.toContainText(/local|offline/i);
  }

  expect(unexpectedErrors(errors)).toEqual([]);
});

import { test, expect } from '@playwright/test';

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('SITE VIVO GATE: canonical landing page loads, reacts and links back to Studio', async ({ page }) => {
  const errors = captureErrors(page);
  const response = await page.goto('/site/', { waitUntil: 'networkidle' });
  expect(response?.ok()).toBeTruthy();

  await expect(page).toHaveTitle(/PabloVoice — Você tá no estúdio/i);
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir o Studio' })).toHaveAttribute('href', '/');

  const canonicalImages = [
    ['#hero-screen-img', /Tela do PabloVoice/i],
    ['.pablo-dock img', /Pablo canônico/i],
    ['#companions img', /Painel dos companions/i],
  ];
  for (const [selector, alt] of canonicalImages) {
    const image = page.locator(selector).first();
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('alt', alt);
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  }

  await page.getByRole('button', { name: 'Voice Lab' }).click();
  await expect(page.locator('#tab-voice')).toHaveClass(/active/);
  await expect(page.locator('#reaction-title')).toHaveText('Modo Voice Lab');
  await expect(page.locator('#reaction-meter-fill')).toHaveCSS('width', /.+/);

  await page.getByRole('button', { name: 'Beat Lab' }).click();
  await expect(page.locator('#tab-beat')).toHaveClass(/active/);
  await expect(page.locator('#reaction-title')).toHaveText('Modo Beat Lab');

  await page.getByRole('link', { name: 'Companions' }).click();
  await expect(page.locator('#companions')).toBeInViewport();
  await expect(page.getByText('Vinyl Groove', { exact: true })).toBeVisible();
  await expect(page.getByText('EQ Bloom', { exact: true })).toBeVisible();

  expect(errors.filter((message) => !/favicon/i.test(message))).toEqual([]);
});

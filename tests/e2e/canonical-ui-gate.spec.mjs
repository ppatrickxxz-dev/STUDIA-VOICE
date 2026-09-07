import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const companionNames = ['Nota Drop', 'Star Spark', 'Wave Ribbon', 'EQ Bloom', 'Chime Lantern', 'Vinyl Groove'];
const evidenceDir = 'test-results/canonical-ui';

async function expectImageLoaded(locator) {
  await expect(locator).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => locator.evaluate((img) => Boolean(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)), { timeout: 10_000 }).toBe(true);
}

async function screenshot(page, name) {
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true, animations: 'disabled' });
}

test('CANONICAL UI GATE: real Pablo and six Companions survive Home and Creator', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-ui-canon', 'retro-tape-onyx-galaxy-v1');
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();

  const pablo = page.locator('.pv-canon-pablo').first();
  await expect(pablo).toHaveAttribute('src', '/site/assets/pablo_fullbody.webp');
  await expectImageLoaded(pablo);

  const board = page.locator('[data-canon-companions] img');
  await expect(board).toHaveAttribute('src', '/site/assets/companions_board.webp');
  await expectImageLoaded(board);
  for (const name of companionNames) await expect(page.getByText(name, { exact: true })).toBeVisible();
  await screenshot(page, 'home-desktop');

  await page.getByRole('button', { name: 'Criar música' }).click();
  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  const creatorPablo = page.locator('.pv-canon-creator-banner img');
  await expect(creatorPablo).toHaveAttribute('src', '/site/assets/pablo_fullbody.webp');
  await expectImageLoaded(creatorPablo);
  await screenshot(page, 'creator-desktop');

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/ElevenLabs|Eleven Music|Music v2|\bSuno\b/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expectImageLoaded(page.locator('.pv-canon-pablo').first());
  await screenshot(page, 'home-mobile');

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

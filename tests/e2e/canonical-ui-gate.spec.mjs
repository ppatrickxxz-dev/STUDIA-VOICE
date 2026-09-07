import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const companionNames = ['Nota Drop', 'Star Spark', 'Wave Ribbon', 'EQ Bloom', 'Chime Lantern', 'Vinyl Groove'];
const evidenceDir = 'test-results/canonical-ui';

async function expectImageLoaded(locator, { visible = true } = {}) {
  if (visible) await expect(locator).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => locator.evaluate((img) => Boolean(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)), { timeout: 10_000 }).toBe(true);
}

async function screenshot(page, name) {
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true, animations: 'disabled' });
}

test('CANONICAL UI GATE: PabloVoice stays canonical and creator-first', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-pv-ui-canon', 'retro-tape-onyx-galaxy-v1');
  await expect(page.locator('html')).toHaveAttribute('data-pv-product-ux', 'creator-first-v2');
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();

  const pablo = page.locator('.pv-canon-pablo').first();
  await expect(pablo).toHaveAttribute('src', '/site/assets/pablo_fullbody.webp');
  await expectImageLoaded(pablo);

  const board = page.locator('[data-canon-companions] img');
  await expect(board).toHaveAttribute('src', '/site/assets/companions_board.webp');
  await expectImageLoaded(board, { visible: false });
  for (const name of companionNames) await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText('Ferramentas desta versão')).toBeHidden();
  await expect(page.getByText('Star Spark', { exact: true }).first()).toBeVisible();

  const desktopNavDirection = await page.locator('.pv-nav').evaluate((nav) => getComputedStyle(nav).flexDirection);
  expect(desktopNavDirection).toBe('column');
  await screenshot(page, 'home-desktop');

  // Home → Criar música must create a project when needed and continue directly
  // into the Creator instead of dropping the user into an empty technical state.
  await page.getByRole('button', { name: 'Criar música' }).click();
  await expect(page.getByRole('heading', { name: 'Novo projeto' })).toBeVisible();
  await page.locator('[data-form="new-project"] .pv-btn.primary').click();

  const creator = page.locator('#pv-song-creator');
  await expect(creator).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /Transforme uma ideia em música/i })).toBeVisible();
  const creatorPablo = page.locator('.pv-canon-creator-banner img');
  await expect(creatorPablo).toHaveAttribute('src', '/site/assets/pablo_fullbody.webp');
  await expectImageLoaded(creatorPablo);

  const creatorPlacement = await page.evaluate(() => {
    const lyricsGrid = document.querySelector('#lyrics')?.closest('.pv-grid');
    const creatorNode = document.querySelector('#pv-song-creator');
    return Boolean(lyricsGrid && creatorNode && lyricsGrid.nextElementSibling === creatorNode);
  });
  expect(creatorPlacement).toBe(true);

  await expect(creator.locator('.pv-creator-advanced')).not.toHaveAttribute('open', '');
  await expect(creator.getByText('⚡ Ideia rápida', { exact: true })).toBeVisible();
  await expect(creator.getByText('✦ Produzir música', { exact: true }).first()).toBeVisible();
  await expect(creator.locator('.pv-creator-pablo-assistant')).toBeVisible();
  await expect(creator.locator('#pv-ai-composer')).toHaveCount(1);
  await expect(page.locator('#pv-remote-pairing')).toHaveCount(1);
  await expect(page.locator('#pv-remote-pairing')).toBeHidden();
  await screenshot(page, 'creator-clean-desktop');

  // Activation is demand-driven: asking for full production reveals it, but it
  // does not occupy the creation flow before the user requests an online action.
  await creator.locator('[data-song-create-hq]').click();
  await expect(page.locator('#pv-remote-pairing')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ativar criação completa' })).toBeVisible();
  await screenshot(page, 'creator-activation-desktop');

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/ElevenLabs|Eleven Music|Music v2|\bSuno\b/i);

  await page.getByRole('button', { name: 'Início' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await expectImageLoaded(page.locator('.pv-canon-pablo').first());
  const mobileNavDirection = await page.locator('.pv-nav').evaluate((nav) => getComputedStyle(nav).flexDirection);
  expect(mobileNavDirection).not.toBe('column');

  // Mobile keeps the musical action card ahead of the large Pablo card.
  const mobileOrder = await page.evaluate(() => {
    const primary = document.querySelector('.pv-product-home-primary')?.getBoundingClientRect();
    const pabloCard = document.querySelector('.pv-home-grid > .companion-card')?.getBoundingClientRect();
    return primary && pabloCard ? primary.top < pabloCard.top : false;
  });
  expect(mobileOrder).toBe(true);
  await screenshot(page, 'home-mobile');

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

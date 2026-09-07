import { test, expect } from '@playwright/test';

async function seedSectionsAndTake(page, { withSongId }) {
  await page.evaluate(async ({ withSongId }) => {
    const storage = await import('./storage.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    let map = project.arrangementMap;
    map = sections.upsertConfirmedSection(map, { kind: 'verse', startSeconds: 0, endSeconds: 20, source: 'song_creation_runtime_v1', confidence: 1 });
    map = sections.upsertConfirmedSection(map, { kind: 'chorus', startSeconds: 20, endSeconds: 40, source: 'song_creation_runtime_v1', confidence: 1 });
    map = sections.upsertConfirmedSection(map, { kind: 'bridge', startSeconds: 40, endSeconds: 60, source: 'song_creation_runtime_v1', confidence: 1 });
    project.arrangementMap = map;
    project.songCreation = {
      schema: 'pablovoice_song_creation_v1',
      latestTakeId: 'take_hq_1',
      takes: [{
        id: 'take_hq_1',
        durationSeconds: 60,
        bpm: 120,
        key: 'A',
        mode: 'minor',
        genre: 'rnb',
        mood: 'noturno',
        brief: 'R&B moderno com synths e baixo quente',
        providerSongId: withSongId ? 'song_ui_gate' : null,
        guideLines: [
          { startBeat: 42, text: 'Amanhã a gente vê' },
          { startBeat: 50, text: 'Deixa a noite acontecer' },
        ],
        render: { provider: withSongId ? 'elevenmusic' : 'local_dsp', model: withSongId ? 'music_v2' : null },
      }],
    };
    await storage.saveProject(project);
  }, { withSongId });
}

async function openSectionMap(page) {
  await page.locator('[data-route="studio"]').first().click();
  await expect(page.locator('[data-section-map-open]')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-section-map-open]').click();
  await expect(page.locator('[data-section-map-modal]')).toBeVisible();
}

test('MUSIC SECTION REGEN UI GATE: local takes show no fake action; HQ song-id enables exact-section panel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Regeneração Seletiva');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();

  await seedSectionsAndTake(page, { withSongId: false });
  await openSectionMap(page);
  await expect(page.locator('[data-music-regen-readiness]')).toContainText('Crie uma demo HQ');
  await expect(page.locator('[data-music-section-regen]')).toHaveCount(0);
  await page.locator('[data-section-map-close]').click();

  await seedSectionsAndTake(page, { withSongId: true });
  await page.locator('[data-section-map-open]').click();
  await expect(page.locator('[data-music-regen-readiness]')).toContainText('Edição musical seletiva pronta');
  await expect(page.locator('[data-music-section-regen]')).toHaveCount(3);

  const chorusRow = page.locator('[data-section-row]').filter({ hasText: 'Refrão' });
  await chorusRow.locator('[data-music-section-regen]').click();
  const panel = page.locator('[data-music-regen-panel]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Refazer só Refrão');
  await expect(panel).toContainText('0:20 → 0:40');
  await expect(panel).toContainText('restante da música');
  await expect(panel.locator('input[name="direction"]')).toBeVisible();
  await expect(panel.locator('textarea[name="lyrics"]')).toHaveAttribute('placeholder', /Deixe vazio para manter/);
  await expect(panel.locator('[data-music-regen-submit]')).toBeVisible();

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

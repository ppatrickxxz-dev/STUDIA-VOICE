import { stat } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

function unexpectedErrors(errors) {
  return errors.filter((message) =>
    !/favicon/i.test(message) &&
    !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message)
  );
}

test('SONG CREATION GATE: lyrics become persisted instrumental + guide, PMI evidence and exportable Studio mix', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Criação Musical');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Gate Criação Musical' })).toBeVisible();

  await page.locator('[data-route="compose"]').first().click();
  await expect(page.locator('#lyrics')).toBeVisible();
  await page.locator('#lyrics').fill('Quando a cidade apaga eu vejo você\nChega mais perto, deixa acontecer\nHoje eu não prometo o que vem depois\nQuando amanhecer, amanhã a gente vê');

  await expect(page.locator('#pv-song-creator')).toBeVisible({ timeout: 10_000 });
  const form = page.locator('[data-song-create-form]');
  await form.locator('input[name="brief"]').fill('Pop R&B noturno, synths suaves, grave redondo e refrão aberto');
  const advanced = form.locator('.pv-creator-advanced');
  if (await advanced.count()) await advanced.locator('summary').click();
  await form.locator('select[name="genre"]').selectOption('rnb');
  await form.locator('input[name="bpm"]').fill('112');
  await form.locator('select[name="duration"]').selectOption('60');
  await form.locator('select[name="key"]').selectOption('A');
  await form.locator('input[name="mood"]').fill('íntimo, elegante, noturno');
  await form.locator('[data-song-create-button]').click();

  await expect(page.locator('#pv-song-create-status')).toContainText('Pronto.', { timeout: 45_000 });
  await expect(page.locator('#pv-song-create-result audio')).toHaveCount(2);
  await expect(page.locator('#pv-song-create-result')).toContainText('112 BPM');
  await expect(page.locator('#pv-song-create-result')).toContainText('PMI · Letra guiando a música');

  const evidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const instrumental = project.tracks.find((track) => track.kind === 'generated_instrumental');
    const guide = project.tracks.find((track) => track.kind === 'guide_melody');
    const instrumentalAsset = await storage.getAudioAsset(instrumental?.assetId);
    const guideAsset = await storage.getAudioAsset(guide?.assetId);
    const take = project.songCreation?.takes?.at(-1) || null;
    return {
      name: project.name,
      preset: project.preset,
      trackCount: project.tracks.length,
      instrumental: instrumental ? { role: instrumental.role, duration: instrumental.duration, bytes: instrumentalAsset?.blob?.size || 0 } : null,
      guide: guide ? { role: guide.role, guideType: guide.guideType, replaceableByVoice: guide.replaceableByVoice, duration: guide.duration, bytes: guideAsset?.blob?.size || 0 } : null,
      takeCount: project.songCreation?.takes?.length || 0,
      bpm: take?.bpm || null,
      key: take?.key || null,
      intelligenceEngine: take?.intelligence?.engine || null,
      intelligenceSchema: take?.intelligence?.schema || null,
      creationMode: take?.intelligence?.creationMode || null,
      conceptTension: take?.intelligence?.concept?.tension || null,
      conceptPayoff: take?.intelligence?.concept?.payoff || null,
      lyricMeter: take?.intelligence?.lyricCritique?.dimensions?.meter ?? null,
      sections: project.arrangementMap?.sections?.length || 0,
      confirmedSections: (project.arrangementMap?.sections || []).filter((section) => section.timingStatus === 'confirmed' && section.source === 'song_creation_runtime_v1').length,
    };
  });

  expect(evidence.name).toBe('Gate Criação Musical');
  expect(evidence.preset).toBe('music');
  expect(evidence.trackCount).toBe(2);
  expect(evidence.instrumental?.role).toBe('instrumental');
  expect(evidence.instrumental?.bytes).toBeGreaterThan(44);
  expect(evidence.guide?.role).toBe('guide_vocal_target');
  expect(evidence.guide?.guideType).toBe('synth_melody');
  expect(evidence.guide?.replaceableByVoice).toBe(true);
  expect(evidence.guide?.bytes).toBeGreaterThan(44);
  expect(evidence.takeCount).toBe(1);
  expect(evidence.bpm).toBe(112);
  expect(evidence.key).toBe('A');
  expect(evidence.intelligenceEngine).toBe('pmi-music-1.0');
  expect(evidence.intelligenceSchema).toBe('pablovoice_song_creation_intelligence_v1');
  expect(evidence.creationMode).toBe('lyrics_led');
  expect(evidence.conceptTension).toBeTruthy();
  expect(evidence.conceptPayoff).toBeTruthy();
  expect(typeof evidence.lyricMeter).toBe('number');
  expect(evidence.sections).toBeGreaterThanOrEqual(6);
  expect(evidence.confirmedSections).toBeGreaterThanOrEqual(6);

  await page.locator('[data-song-open-studio]').click();
  await expect(page.getByRole('heading', { name: 'Gate Criação Musical' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: 'Mixer' }).click();
  await expect(page.getByText('Instrumental · Take 1').first()).toBeVisible();
  await expect(page.getByText('Guia melódica · Take 1').first()).toBeVisible();

  const mixDownloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').first().click();
  const mixDownload = await mixDownloadPromise;
  const mixPath = await mixDownload.path();
  expect(mixPath).toBeTruthy();
  expect((await stat(mixPath)).size).toBeGreaterThan(44);

  expect(unexpectedErrors(errors)).toEqual([]);
});
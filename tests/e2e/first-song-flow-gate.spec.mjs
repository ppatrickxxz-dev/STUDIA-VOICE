import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.2, sampleRate = 44100, frequency = 196 } = {}) {
  const samples = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 2500, (samples - index) / 2500);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.24 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

test('FIRST SONG FLOW GATE: idea creates its project, survives reopen and exports without waiting for My Voice', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/', { waitUntil: 'networkidle' });
  const prompt = 'Tão eu — pop R&B brasileiro, íntimo, baixo synth, bateria solta, refrão forte';

  const home = page.locator('#pv-product-home');
  await expect(home).toBeVisible({ timeout: 12_000 });
  await home.locator('[data-pv-product-prompt]').fill(prompt);
  await home.locator('[data-pv-product-create="song"]').click();

  const form = page.locator('[data-song-create-form]');
  await expect(form).toBeVisible({ timeout: 10_000 });
  await expect(form.locator('input[name="brief"]')).toHaveValue(prompt);
  await page.locator('#lyrics').fill('Jurando que já me esqueceu\nMas toda vez volta a ligar\nFala de mim sem perceber\nTão eu no jeito de negar');

  const bootstrap = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const id = storage.activeProjectSessionId();
    const project = id ? await storage.getProject(id) : null;
    return { id, name: project?.name || null, tracks: project?.tracks?.length ?? -1 };
  });
  expect(bootstrap.id).toBeTruthy();
  expect(bootstrap.name).toContain('Tão eu');
  expect(bootstrap.tracks).toBe(0);

  // Physical AI generation has its own live canary. This fixture starts exactly
  // at the verified-audio boundary and proves the product continuity after it.
  await page.locator('.pv-nav [data-route="studio"]').last().click();
  await page.locator('#audio-picker').setInputFiles({
    name: 'tao-eu-generated-master.wav',
    mimeType: 'audio/wav',
    buffer: wavFixture(),
  });
  await expect(page.getByText('tao-eu-generated-master.wav').first()).toBeVisible();

  const model = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const { songModelReadiness } = await import('./song-model-v3.mjs');
    const id = storage.activeProjectSessionId();
    const project = await storage.getProject(id);
    const master = project.tracks.find((track) => track.id === project.activeTrackId) || project.tracks[0];
    master.kind = 'ai_music_demo';
    master.role = 'reference_mix';
    project.lyrics = 'Jurando que já me esqueceu\nMas toda vez volta a ligar\nFala de mim sem perceber\nTão eu no jeito de negar';
    project.songCreation = {
      schema: 'pablovoice_song_creation_v1',
      latestTakeId: 'first-song-gate-take',
      takes: [{
        id: 'first-song-gate-take',
        schema: 'pablovoice_song_creation_v1',
        brief: 'Tão eu — pop R&B brasileiro',
        genre: 'rnb',
        mood: 'íntimo',
        bpm: 108,
        key: 'F#m',
        mode: 'minor',
        durationSeconds: master.duration,
        referenceTrackId: master.id,
        guideType: 'synth_melody',
        sections: [{ id: 'verso_1', label: 'Verso 1', startSeconds: 0, endSeconds: master.duration }],
        lyricsSnapshot: project.lyrics,
      }],
    };
    const saved = await storage.saveProject(project);
    return { schema: saved.songModel?.schema, readiness: songModelReadiness(saved), name: saved.name };
  });

  expect(model.schema).toBe('pablovoice_song_model_v3');
  expect(model.readiness.compositionReady).toBe(true);
  expect(model.readiness.mixReady).toBe(true);
  expect(model.readiness.firstSongReady).toBe(true);
  expect(model.readiness.voiceReplacementReady).toBe(false);

  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText(model.name).first()).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText(model.name).first()).toBeVisible();
  await page.locator('[data-action="open-project"]').first().click();
  await expect(page.getByRole('heading', { name: model.name })).toBeVisible();
  await expect(page.getByText('tao-eu-generated-master.wav').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-pv-studio-cut', 'song_completion_v1');

  const persisted = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const { songModelReadiness } = await import('./song-model-v3.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return { schema: project?.songModel?.schema, readiness: songModelReadiness(project) };
  });
  expect(persisted.schema).toBe('pablovoice_song_model_v3');
  expect(persisted.readiness.firstSongReady).toBe(true);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  expect(await download.path()).toBeTruthy();
});
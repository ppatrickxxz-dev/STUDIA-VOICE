import { test, expect } from '@playwright/test';

async function sendPablo(page, message) {
  const form = page.locator('[data-pablo-form]');
  await form.locator('input[name="message"]').fill(message);
  await form.getByRole('button', { name: 'Enviar' }).click();
}

async function createProject(page, name) {
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill(name);
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function seedBassInstrument(page) {
  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    project.instrumentLab = {
      version: '2.0-local',
      preset: 'bass',
      bpm: 105,
      notes: [
        { midi: 36, velocity: 96, start_beat: 0, duration_beats: 0.5 },
        { midi: 36, velocity: 96, start_beat: 1, duration_beats: 0.5 },
        { midi: 39, velocity: 98, start_beat: 2, duration_beats: 0.5 },
        { midi: 41, velocity: 100, start_beat: 3, duration_beats: 0.5 },
      ],
    };
    await storage.saveProject(project);
  });
}

async function seedConnectedChorus(page) {
  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const core = await import('./core/src/project.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const referenceTrack = core.createTrack({
      name: 'Versão conectada · Take 1',
      assetId: 'asset_connected_gate_1',
      type: 'audio/mpeg',
      duration: 60,
      sampleRate: 48000,
      channels: 2,
      kind: 'ai_music_demo',
    });
    Object.assign(referenceTrack, {
      role: 'reference_mix',
      songTakeId: 'songtake_connected_gate_1',
      source: 'connected_music_runtime',
      provider: 'elevenmusic',
      providerModel: 'music_v2',
      providerSongId: 'song_provider_gate_1',
    });
    project.tracks.push(referenceTrack);
    project.activeTrackId = referenceTrack.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus',
      startSeconds: 10,
      endSeconds: 20,
      source: 'gate',
      confidence: 1,
    });
    project.songCreation = {
      latestTakeId: 'songtake_connected_gate_1',
      takes: [{
        id: 'songtake_connected_gate_1',
        providerSongId: 'song_provider_gate_1',
        referenceTrackId: referenceTrack.id,
        durationSeconds: 60,
        bpm: 105,
        key: 'A',
        mode: 'minor',
        genre: 'rnb',
        mood: 'sensual',
        brief: 'R&B moderno e elegante',
        guideLines: [],
        render: { provider: 'elevenmusic', model: 'music_v2' },
      }],
    };
    await storage.saveProject(project);
  });
}

async function instrumentState(page) {
  return page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return {
      id: project.id,
      revisions: project.revisions.length,
      notes: project.instrumentLab?.notes || [],
      preset: project.instrumentLab?.preset || null,
      bpm: project.instrumentLab?.bpm || null,
    };
  });
}

function unexpectedErrors(errors) {
  return errors.filter((message) =>
    !/favicon/i.test(message) &&
    !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message)
  );
}

test('MUSICAL PLAN REVIEW GATE: natural language bass edit previews, applies once, preserves pitch and persists', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await createProject(page, 'Gate Ajuste Instrumental');

  await seedBassInstrument(page);
  const before = await instrumentState(page);
  expect(before.preset).toBe('bass');
  expect(before.bpm).toBe(105);
  expect(before.notes.map((note) => note.midi)).toEqual([36, 36, 39, 41]);

  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.locator('[data-pablo-form]')).toBeVisible({ timeout: 10_000 });
  await sendPablo(page, 'deixa esse baixo menos quadrado e mais vivo');

  const planMessage = page.locator('.pv-msg.assistant').filter({ has: page.locator('[data-musical-plan-actions]') }).last();
  await expect(planMessage).toBeVisible({ timeout: 10_000 });
  await expect(planMessage).toContainText(/alvo: baixo/i);
  await expect(planMessage.locator('[data-musical-plan-detail]')).toContainText(/ajuste MIDI reversível/i);
  await expect(planMessage.locator('[data-musical-plan-detail]')).toContainText(/pitch e quantidade de notas ficam preservados/i);
  await expect(planMessage.getByRole('button', { name: 'Ouvir prévia' })).toBeVisible();
  await expect(planMessage.getByRole('button', { name: 'Aplicar ajuste' })).toBeVisible();
  await expect(page.getByText(/Não consegui usar essa análise: dados insuficientes/i)).toHaveCount(0);

  const beforeApply = await instrumentState(page);
  expect(beforeApply).toEqual(before);

  await planMessage.getByRole('button', { name: 'Aplicar ajuste' }).click();
  await expect(planMessage.getByRole('button', { name: 'Aplicado ✓' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Ajuste MIDI aplicado e salvo/i).last()).toBeVisible();

  const after = await instrumentState(page);
  expect(after.revisions).toBe(before.revisions + 2);
  expect(after.preset).toBe(before.preset);
  expect(after.bpm).toBe(before.bpm);
  expect(after.notes).toHaveLength(before.notes.length);
  expect(after.notes.map((note) => note.midi)).toEqual(before.notes.map((note) => note.midi));
  expect(after.notes).not.toEqual(before.notes);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  const persisted = await instrumentState(page);
  expect(persisted.revisions).toBe(after.revisions);
  expect(persisted.notes).toEqual(after.notes);
  expect(persisted.notes.map((note) => note.midi)).toEqual([36, 36, 39, 41]);

  expect(unexpectedErrors(errors)).toEqual([]);
});

test('MUSICAL PLAN REVIEW GATE: Pablo reviews a local section edit without provider side effects before click', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  const providerRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    if (/\/api\/music-regeneration(?:\?|$)/.test(request.url())) providerRequests.push(request.url());
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await createProject(page, 'Gate Edição Conversacional');
  await seedConnectedChorus(page);

  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.locator('[data-pablo-form]')).toBeVisible({ timeout: 10_000 });
  await sendPablo(page, 'abre mais o refrão sem mexer no resto');

  const generationMessage = page.locator('.pv-msg.assistant').filter({ has: page.locator('[data-musical-generation-actions]') }).last();
  await expect(generationMessage).toBeVisible({ timeout: 10_000 });
  await expect(generationMessage.locator('[data-musical-plan-detail]')).toContainText(/Edição por seção preparada/i);
  await expect(generationMessage.locator('[data-musical-plan-meta]')).toContainText(/Wave · edição por seção/i);
  await expect(generationMessage.locator('[data-musical-generation-target]')).toContainText(/Refrão · 0:10 · seção confirmada no mapa/i);
  await expect(generationMessage.locator('[data-musical-generation-safety]')).toContainText(/restante e a versão anterior ficam preservados/i);
  await expect(generationMessage.getByRole('button', { name: /Gerar nova versão/i })).toBeVisible();
  await expect(page.getByText(/Não consegui usar essa análise: dados insuficientes/i)).toHaveCount(0);
  expect(providerRequests).toHaveLength(0);
  expect(unexpectedErrors(errors)).toEqual([]);
});

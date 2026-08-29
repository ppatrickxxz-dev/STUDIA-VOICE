import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.6, sampleRate = 44100, frequency = 300 } = {}) {
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
    const envelope = Math.min(1, index / 1800, (samples - index) / 1800);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.18 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

async function sendPablo(page, message) {
  const form = page.locator('[data-pablo-form]');
  await form.locator('input[name="message"]').fill(message);
  await form.getByRole('button', { name: 'Enviar' }).click();
}

async function seedProject(page) {
  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const core = await import('./core/src/project.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks[0];
    vocal.kind = 'recording';
    vocal.name = 'Voz principal';
    const support = core.createTrack({
      name: 'Instrumental', assetId: vocal.assetId, type: vocal.type,
      duration: vocal.duration, sampleRate: vocal.sampleRate, channels: vocal.channels, kind: 'audio',
    });
    project.tracks.push(support);
    project.activeTrackId = support.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus', startSeconds: 0.3, endSeconds: 0.95, source: 'user_manual', confidence: 1,
    });
    await storage.saveProject(project);
  });
}

test('WEB SECTION MIX UNDO GATE: Pablo removes only his requested section mix edits', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate undo por seção');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'undo-section.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('undo-section.wav').first()).toBeVisible();
  await seedProject(page);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'aumenta minha voz só no refrão');
  await expect(page.getByText(/Studio · edição regional salva/i).last()).toBeVisible({ timeout: 10_000 });
  await sendPablo(page, 'abre espaço pra minha voz só no refrão');
  await expect(page.getByText(/Studio · espaço regional salvo/i).last()).toBeVisible({ timeout: 10_000 });

  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    vocal.regionAutomation.push(
      { id: 'manual_keep', kind: 'gain', startSeconds: 0.4, endSeconds: 0.5, gainDb: -0.5, confidence: 1, source: 'user_manual', enabled: true },
      { id: 'breath_keep', kind: 'gain', startSeconds: 0.6, endSeconds: 0.7, gainDb: -2, confidence: 0.9, source: 'pablo_breath_intelligence', enabled: true },
    );
    await storage.saveProject(project);
  });

  await sendPablo(page, 'desfaz o ganho da voz no refrão');
  await expect(page.getByText(/Desfiz o ganho vocal que eu tinha criado no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  const afterGainUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    return {
      vocalSources: vocal.regionAutomation.map((event) => event.source).sort(),
      supportSources: support.regionAutomation.map((event) => event.source).sort(),
    };
  });
  expect(afterGainUndo.vocalSources).toEqual(['pablo_breath_intelligence', 'user_manual']);
  expect(afterGainUndo.supportSources).toEqual(['pablo_section_vocal_space']);

  await sendPablo(page, 'aumenta minha voz só no refrão');
  await expect(page.getByText(/Studio · edição regional salva/i).last()).toBeVisible();
  await sendPablo(page, 'desfaz o que você fez no refrão');
  await expect(page.getByText(/Desfiz meus ajustes regionais de mix no Refrão/i).last()).toBeVisible({ timeout: 10_000 });

  const afterAllUndo = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    return {
      vocalSources: vocal.regionAutomation.map((event) => event.source).sort(),
      supportSources: support.regionAutomation.map((event) => event.source).sort(),
      labels: project.revisions.map((revision) => revision.label),
    };
  });
  expect(afterAllUndo.vocalSources).toEqual(['pablo_breath_intelligence', 'user_manual']);
  expect(afterAllUndo.supportSources).toEqual([]);
  expect(afterAllUndo.labels.some((label) => /Desfeito ganho vocal no Refrão/.test(label))).toBe(true);
  expect(afterAllUndo.labels.some((label) => /Desfeitos ajustes do Pablo no Refrão/.test(label))).toBe(true);

  await sendPablo(page, 'desfaz o que você fez no refrão');
  await expect(page.getByText(/Não encontrei ajustes regionais de mix criado pelo Pablo nesse refrão/i).last()).toBeVisible();

  await sendPablo(page, 'toca o refrão');
  await expect(page.getByText(/Tocando Refrão do início ao fim confirmado/i).last()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(120);
  const playing = await page.evaluate(async () => (await import('./section-audition-runtime.mjs')).getSectionAuditionStatus());
  expect(playing.playing).toBe(true);
  await page.waitForTimeout(850);
  const ended = await page.evaluate(async () => (await import('./section-audition-runtime.mjs')).getSectionAuditionStatus());
  expect(ended.playing).toBe(false);

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

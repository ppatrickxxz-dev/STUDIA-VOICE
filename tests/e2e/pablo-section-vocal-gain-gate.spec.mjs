import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.6, sampleRate = 44100, frequency = 280 } = {}) {
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

async function seedVocalAndSection(page) {
  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const core = await import('./core/src/project.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const source = project.tracks[0];
    source.kind = 'recording';
    source.name = 'Voz principal';
    const instrumental = core.createTrack({
      name: 'Instrumental',
      assetId: source.assetId,
      type: source.type,
      duration: source.duration,
      sampleRate: source.sampleRate,
      channels: source.channels,
      kind: 'audio',
    });
    project.tracks.push(instrumental);
    project.activeTrackId = instrumental.id;
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus', startSeconds: 0.3, endSeconds: 0.95, source: 'user_manual', confidence: 1,
    });
    await storage.saveProject(project);
  });
}

test('WEB SECTION MIX GATE: Pablo boosts vocal and opens support space only inside a complete confirmed chorus', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate mix por seção');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'voice-section.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('voice-section.wav').first()).toBeVisible();
  await seedVocalAndSection(page);

  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.locator('[data-pablo-form]')).toBeVisible();

  await sendPablo(page, 'aumenta minha voz 8 dB no refrão');
  await expect(page.getByText(/só aplico aumento regional de até \+4 dB automaticamente/i).last()).toBeVisible();
  const afterUnsafeVocal = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return project.tracks.map((track) => track.regionAutomation.length);
  });
  expect(afterUnsafeVocal).toEqual([0, 0]);

  await sendPablo(page, 'aumenta minha voz só no refrão');
  await expect(page.getByText(/Subi a faixa “Voz principal” em \+2 dB somente no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Studio · edição regional salva/i).last()).toBeVisible();

  const vocalSaved = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const instrumental = project.tracks.find((track) => track.kind === 'audio');
    const event = vocal.regionAutomation.find((item) => item.source === 'pablo_section_vocal_gain');
    return {
      vocalId: vocal.id,
      activeTrackId: project.activeTrackId,
      vocalEvents: vocal.regionAutomation,
      instrumentalEvents: instrumental.regionAutomation,
      event,
      labels: project.revisions.map((revision) => revision.label),
    };
  });
  expect(vocalSaved.activeTrackId).not.toBe(vocalSaved.vocalId);
  expect(vocalSaved.vocalEvents).toHaveLength(1);
  expect(vocalSaved.instrumentalEvents).toHaveLength(0);
  expect(vocalSaved.event.kind).toBe('gain');
  expect(vocalSaved.event.startSeconds).toBe(0.3);
  expect(vocalSaved.event.endSeconds).toBe(0.95);
  expect(vocalSaved.event.gainDb).toBe(2);
  expect(vocalSaved.event.confidence).toBe(1);
  expect(vocalSaved.event.enabled).toBe(true);
  expect(vocalSaved.labels.some((label) => /Voz \+2 dB no Refrão/.test(label))).toBe(true);

  await sendPablo(page, 'sobe minha voz no refrão');
  const repeatedVocal = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    return vocal.regionAutomation.filter((item) => item.source === 'pablo_section_vocal_gain');
  });
  expect(repeatedVocal).toHaveLength(1);

  await sendPablo(page, 'reduz o instrumental 6 dB no refrão');
  await expect(page.getByText(/só atenúo automaticamente até 3 dB por seção/i).last()).toBeVisible();
  const afterUnsafeSpace = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const instrumental = project.tracks.find((track) => track.kind === 'audio');
    return instrumental.regionAutomation.length;
  });
  expect(afterUnsafeSpace).toBe(0);

  await sendPablo(page, 'abre espaço pra minha voz só no refrão');
  await expect(page.getByText(/reduzindo “Instrumental” em 1.5 dB somente no Refrão/i).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Studio · espaço regional salvo/i).last()).toBeVisible();

  const spaced = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const instrumental = project.tracks.find((track) => track.kind === 'audio');
    const event = instrumental.regionAutomation.find((item) => item.source === 'pablo_section_vocal_space');
    return {
      vocalEvents: vocal.regionAutomation,
      instrumentalEvents: instrumental.regionAutomation,
      event,
      labels: project.revisions.map((revision) => revision.label),
    };
  });
  expect(spaced.vocalEvents.filter((item) => item.source === 'pablo_section_vocal_gain')).toHaveLength(1);
  expect(spaced.vocalEvents.filter((item) => item.source === 'pablo_section_vocal_space')).toHaveLength(0);
  expect(spaced.instrumentalEvents).toHaveLength(1);
  expect(spaced.event.startSeconds).toBe(0.3);
  expect(spaced.event.endSeconds).toBe(0.95);
  expect(spaced.event.gainDb).toBe(-1.5);
  expect(spaced.event.confidence).toBe(1);
  expect(spaced.labels.some((label) => /Espaço vocal -1.5 dB no Refrão/.test(label))).toBe(true);

  await sendPablo(page, 'abaixa o instrumental no refrão');
  const repeatedSpace = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const instrumental = project.tracks.find((track) => track.kind === 'audio');
    return instrumental.regionAutomation.filter((item) => item.source === 'pablo_section_vocal_space');
  });
  expect(repeatedSpace).toHaveLength(1);

  await sendPablo(page, 'toca o refrão');
  await expect(page.getByText(/Tocando Refrão do início ao fim confirmado/i).last()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(120);
  const playing = await page.evaluate(async () => (await import('./section-audition-runtime.mjs')).getSectionAuditionStatus());
  expect(playing.playing).toBe(true);
  expect(playing.startSeconds).toBe(0.3);
  expect(playing.endSeconds).toBe(0.95);
  await page.waitForTimeout(850);
  const ended = await page.evaluate(async () => (await import('./section-audition-runtime.mjs')).getSectionAuditionStatus());
  expect(ended.playing).toBe(false);

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.6, sampleRate = 44100, frequency = 320 } = {}) {
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

async function projectSnapshot(page) {
  return page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    const support = project.tracks.find((track) => track.kind === 'audio');
    return {
      vocalSources: vocal.regionAutomation.map((event) => event.source).sort(),
      supportSources: support.regionAutomation.map((event) => event.source).sort(),
      revisionCount: project.revisions.length,
    };
  });
}

test('WEB SECTION MIX A/B GATE: A removes only Pablo section mix in memory and decisions stay safe', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate A B por seção');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'ab-section.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('ab-section.wav').first()).toBeVisible();
  await seedProject(page);

  await page.locator('[data-route="pablo"]').first().click();
  await sendPablo(page, 'compara o refrão');
  await expect(page.getByText(/Não há ajustes regionais meus nesse refrão para fazer A\/B/i).last()).toBeVisible();

  await sendPablo(page, 'aumenta minha voz só no refrão');
  await expect(page.getByText(/Studio · edição regional salva/i).last()).toBeVisible({ timeout: 10_000 });
  await sendPablo(page, 'abre espaço pra minha voz só no refrão');
  await expect(page.getByText(/Studio · espaço regional salvo/i).last()).toBeVisible({ timeout: 10_000 });

  await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    const vocal = project.tracks.find((track) => track.kind === 'recording');
    vocal.regionAutomation.push(
      { id: 'manual_ab_keep', kind: 'gain', startSeconds: 0.4, endSeconds: 0.5, gainDb: -0.5, confidence: 1, source: 'user_manual', enabled: true },
      { id: 'breath_ab_keep', kind: 'gain', startSeconds: 0.6, endSeconds: 0.7, gainDb: -2, confidence: 0.9, source: 'pablo_breath_intelligence', enabled: true },
    );
    await storage.saveProject(project);
  });

  const beforeAB = await projectSnapshot(page);
  expect(beforeAB.vocalSources).toEqual(['pablo_breath_intelligence', 'pablo_section_vocal_gain', 'user_manual']);
  expect(beforeAB.supportSources).toEqual(['pablo_section_vocal_space']);

  await sendPablo(page, 'faz A/B do refrão');
  const panel = page.locator('[data-section-mix-ab]').last();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/A mantém toda a mix processada/i);

  await panel.getByRole('button', { name: 'Ouvir A' }).click();
  await expect(panel.locator('small')).toContainText(/Tocando A · 2 ajuste\(s\) do Pablo removido/i);
  await page.waitForTimeout(120);
  const aStatus = await page.evaluate(async () => (await import('./section-mix-ab-runtime.mjs')).getSectionMixABStatus());
  expect(aStatus.variant).toBe('A');
  expect(aStatus.comparedEvents).toBe(2);
  expect(aStatus.removedEvents).toBe(2);
  expect(aStatus.playing).toBe(true);
  expect(aStatus.startSeconds).toBe(0.3);
  expect(aStatus.endSeconds).toBe(0.95);

  const afterA = await projectSnapshot(page);
  expect(afterA).toEqual(beforeAB);

  await panel.getByRole('button', { name: 'Ouvir B' }).click();
  await expect(panel.locator('small')).toContainText(/Tocando B · 2 ajuste\(s\) do Pablo ativos/i);
  await page.waitForTimeout(120);
  const bStatus = await page.evaluate(async () => (await import('./section-mix-ab-runtime.mjs')).getSectionMixABStatus());
  expect(bStatus.variant).toBe('B');
  expect(bStatus.comparedEvents).toBe(2);
  expect(bStatus.removedEvents).toBe(0);
  expect(bStatus.playing).toBe(true);

  await panel.getByRole('button', { name: 'Manter B' }).click();
  await expect(page.getByText(/Mantive os ajustes atuais no Refrão/i).last()).toBeVisible();
  const afterKeep = await projectSnapshot(page);
  expect(afterKeep).toEqual(beforeAB);
  await expect(panel.getByRole('button', { name: 'Ouvir A' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Ouvir B' })).toBeDisabled();
  const stopped = await page.evaluate(async () => (await import('./section-mix-ab-runtime.mjs')).getSectionMixABStatus());
  expect(stopped.playing).toBe(false);

  await sendPablo(page, 'compara o refrão');
  const secondPanel = page.locator('[data-section-mix-ab]').last();
  await expect(secondPanel).toBeVisible();
  await secondPanel.getByRole('button', { name: 'Prefiro A · desfazer' }).click();
  await expect(page.getByText(/Desfiz meus ajustes regionais de mix no Refrão/i).last()).toBeVisible({ timeout: 10_000 });

  const afterUndo = await projectSnapshot(page);
  expect(afterUndo.vocalSources).toEqual(['pablo_breath_intelligence', 'user_manual']);
  expect(afterUndo.supportSources).toEqual([]);
  expect(afterUndo.revisionCount).toBe(beforeAB.revisionCount + 1);

  await sendPablo(page, 'compara o refrão');
  await expect(page.getByText(/Não há ajustes regionais meus nesse refrão para fazer A\/B/i).last()).toBeVisible();

  const unexpected = errors.filter((message) =>
    !/favicon/i.test(message)
    && !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message));
  expect(unexpected).toEqual([]);
});

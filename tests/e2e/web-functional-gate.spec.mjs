import { test, expect } from '@playwright/test';

function wavFixture({ seconds = 1.5, sampleRate = 44100, frequency = 220 } = {}) {
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
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / 3000, (samples - i) / 3000);
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.28 * Math.max(0, envelope);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return buffer;
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function waitForHydratedShell(page) {
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
}

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

function unexpectedErrors(errors) {
  return errors.filter((message) =>
    !/favicon/i.test(message) &&
    !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message)
  );
}

test('WEB FUNCTIONAL GATE: project, audio, edit, preview, persistence, export and Pablo audio conversation', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForHydratedShell(page);
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();
  await expect(page.getByText('Sua ideia ganha som.').first()).toBeVisible();

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Web 2026');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Gate Web 2026' })).toBeVisible();

  await page.locator('#audio-picker').setInputFiles({ name: 'gate-tone.wav', mimeType: 'audio/wav', buffer: wavFixture() });
  await expect(page.getByText('gate-tone.wav').first()).toBeVisible();
  await expect(page.locator('#waveform')).toBeVisible();
  await expect(page.locator('[data-action="export"]').first()).toBeEnabled();

  await setRange(page, 'input[data-control="trimStart"]', 0.1);
  await setRange(page, 'input[data-control="gain"]', 1.1);
  await expect(page.locator('[data-output="trimStart"]')).toContainText('0:00');
  await expect(page.locator('[data-output="gain"]')).toContainText('110%');

  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(350);
  await expect(page.locator('#current-time')).not.toHaveText('0:00.0');
  await page.locator('[data-action="stop"]').click();

  await page.locator('[data-action="studio-tab"][data-value="voice"]').click();
  const clean = page.locator('[data-action="effect"][data-value="clean"]');
  await expect(clean).toHaveClass(/on/);
  await clean.click();
  await expect(clean).not.toHaveClass(/on/);
  await clean.click();
  await expect(clean).toHaveClass(/on/);
  await page.locator('[data-action="ab"][data-value="original"]').click();
  await expect(page.locator('[data-action="ab"][data-value="original"]')).toHaveClass(/active/);
  await page.locator('[data-action="ab"][data-value="processed"]').click();
  await expect(page.locator('[data-action="ab"][data-value="processed"]')).toHaveClass(/active/);

  await page.locator('[data-action="save"]').click();
  await expect(page.getByText('Projeto salvo neste aparelho.')).toBeVisible();
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText('Gate Web 2026').first()).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await waitForHydratedShell(page);
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText('Gate Web 2026').first()).toBeVisible();
  await page.locator('[data-action="open-project"]').first().click();
  await expect(page.getByRole('heading', { name: 'Gate Web 2026' })).toBeVisible();
  await expect(page.getByText('gate-tone.wav').first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export"]').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Gate_Web_2026-.*\.wav$/);
  expect(await download.path()).toBeTruthy();

  await page.locator('[data-route="compose"]').first().click();
  await expect(page.getByText(/Composição|compor|Songwriting/i).first()).toBeVisible();
  await page.locator('[data-route="pablo"]').first().click();
  await expect(page.getByText(/assistente local/i).first()).toBeVisible();

  const pabloInput = page.locator('[data-pablo-form] input[name="message"]');
  await expect(pabloInput).toBeVisible();
  await pabloInput.fill('Analisa esse áudio');
  await page.locator('[data-pablo-form]').getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(/Analisei o áudio/i).last()).toBeVisible({ timeout: 20_000 });

  await pabloInput.fill('Deixa minha voz mais limpa e centraliza ela');
  await page.locator('[data-pablo-form]').getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(/Entendi e apliquei a edição reversível no projeto/i).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/A edição determinística foi aplicada e salva/i).last()).toBeVisible();

  expect(unexpectedErrors(errors)).toEqual([]);
});

test('WEB BEAT TIMELINE GATE: confirmed chorus renders and replaces a real beat-fill track at canonical offset', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForHydratedShell(page);

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Beat Timeline');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'beat-source.wav', mimeType: 'audio/wav', buffer: wavFixture({ seconds: 1.5, frequency: 180 }) });
  await expect(page.getByText('beat-source.wav').first()).toBeVisible();

  const evidence = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const sections = await import('./core/src/section-map.mjs');
    const runtime = await import('./pablo-beat-runtime.mjs');
    const projectId = storage.activeProjectSessionId();
    const project = await storage.getProject(projectId);
    const sourceTrack = project.tracks.find((track) => track.name === 'beat-source.wav') || project.tracks[0];
    if (!sourceTrack?.assetId) throw new Error('Gate source track missing.');

    project.sampler = {
      schema: 'pablovoice_sampler_v2',
      sourceAssetId: sourceTrack.assetId,
      grooveTemplate: { ready: false, bpm: 120, stepsPerBar: 16, offsetsBeats: [], accents: [] },
      pads: [{
        id: 'gate-snare',
        sliceId: 'gate-slice',
        sourceAssetId: sourceTrack.assetId,
        label: 'Caixa gate',
        start: 0.1,
        end: 0.32,
        gain: 1,
        fadeIn: 0.005,
        fadeOut: 0.01,
        playbackRate: 1,
        source: 'audio_onset',
        category: 'snare',
        categoryConfidence: 0.95,
      }],
    };
    project.arrangementMap = sections.upsertConfirmedSection(project.arrangementMap, {
      kind: 'chorus',
      startSeconds: 1,
      source: 'user_manual',
      confidence: 1,
    });
    await storage.saveProject(project);

    const operation = { action: 'fill_before_section', args: { section: 'chorus', occurrence: 1, intensity: 0.65 } };
    const first = await runtime.executePersistedPabloBeatOperation(operation, { projectId });
    const afterFirst = await storage.getProject(projectId);
    const firstFill = afterFirst.tracks.find((track) => track.kind === 'beat-fill');
    const firstAsset = firstFill ? await storage.getAudioAsset(firstFill.assetId) : null;
    const firstAssetId = firstFill?.assetId || null;

    const second = await runtime.executePersistedPabloBeatOperation(operation, { projectId });
    const afterSecond = await storage.getProject(projectId);
    const fills = afterSecond.tracks.filter((track) => track.kind === 'beat-fill');
    const secondFill = fills[0] || null;
    const secondAsset = secondFill ? await storage.getAudioAsset(secondFill.assetId) : null;
    const staleAsset = firstAssetId ? await storage.getAudioAsset(firstAssetId) : null;

    return {
      firstOk: first?.ok === true,
      firstMutated: first?.mutated === true,
      firstKind: firstFill?.kind || null,
      firstOffset: firstFill?.offset ?? null,
      firstTarget: firstFill?.beatTimeline?.targetStartSeconds ?? null,
      firstAssetType: firstAsset?.type || null,
      firstAssetSize: firstAsset?.blob?.size || 0,
      secondOk: second?.ok === true,
      secondMutated: second?.mutated === true,
      replacedPriorFill: second?.data?.replacedPriorFill === true,
      fillCount: fills.length,
      secondOffset: secondFill?.offset ?? null,
      secondTarget: secondFill?.beatTimeline?.targetStartSeconds ?? null,
      secondAssetSize: secondAsset?.blob?.size || 0,
      assetRotated: Boolean(firstAssetId && secondFill?.assetId && firstAssetId !== secondFill.assetId),
      staleAssetDeleted: staleAsset == null,
      sourceTrackPreserved: afterSecond.tracks.some((track) => track.id === sourceTrack.id),
    };
  });

  expect(evidence.firstOk).toBe(true);
  expect(evidence.firstMutated).toBe(true);
  expect(evidence.firstKind).toBe('beat-fill');
  expect(evidence.firstOffset).toBeCloseTo(0.5, 3);
  expect(evidence.firstTarget).toBe(1);
  expect(evidence.firstAssetType).toBe('audio/wav');
  expect(evidence.firstAssetSize).toBeGreaterThan(44);
  expect(evidence.secondOk).toBe(true);
  expect(evidence.secondMutated).toBe(true);
  expect(evidence.replacedPriorFill).toBe(true);
  expect(evidence.fillCount).toBe(1);
  expect(evidence.secondOffset).toBeCloseTo(0.5, 3);
  expect(evidence.secondTarget).toBe(1);
  expect(evidence.secondAssetSize).toBeGreaterThan(44);
  expect(evidence.assetRotated).toBe(true);
  expect(evidence.staleAssetDeleted).toBe(true);
  expect(evidence.sourceTrackPreserved).toBe(true);
  expect(unexpectedErrors(errors)).toEqual([]);
});

test('WEB SECTION MAP UI GATE: current cursor can mark, persist, edit and remove a confirmed chorus', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForHydratedShell(page);

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Sections');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await page.locator('#audio-picker').setInputFiles({ name: 'sections-source.wav', mimeType: 'audio/wav', buffer: wavFixture({ seconds: 1.5, frequency: 240 }) });
  await expect(page.getByText('sections-source.wav').first()).toBeVisible();
  await expect(page.locator('[data-section-map-open]')).toBeVisible();

  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(360);
  await expect(page.locator('#current-time')).not.toHaveText('0:00.0');
  await page.locator('[data-action="stop"]').click();
  await expect(page.locator('#current-time')).toHaveText('0:00.0');

  await page.locator('[data-section-map-open]').click();
  await expect(page.getByRole('heading', { name: 'Seções' })).toBeVisible();
  await page.locator('[data-section-kind]').selectOption('chorus');
  await page.locator('[data-section-use-cursor]').click();
  const cursorValue = await page.locator('[data-section-start]').inputValue();
  expect(cursorValue).not.toBe('0:00');
  await page.getByRole('button', { name: 'Salvar seção' }).click();
  await expect(page.locator('[data-section-row]')).toHaveCount(1);
  await expect(page.locator('[data-section-row]').first()).toContainText('Refrão');
  await expect(page.locator('[data-section-row]').first()).toContainText('timing confirmado');

  await page.locator('[data-section-map-close]').click();
  await page.reload({ waitUntil: 'networkidle' });
  await waitForHydratedShell(page);
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText('Gate Sections').first()).toBeVisible();
  await page.locator('[data-action="open-project"]').first().click();
  await expect(page.locator('[data-section-map-open]')).toBeVisible();
  await page.locator('[data-section-map-open]').click();
  await expect(page.locator('[data-section-row]')).toHaveCount(1);

  await page.locator('[data-section-edit]').first().click();
  await page.locator('[data-section-start]').fill('1.0');
  await page.locator('[data-section-end]').fill('1.2');
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.locator('[data-section-row]')).toHaveCount(1);
  await expect(page.locator('[data-section-row]').first()).toContainText('0:01');
  await expect(page.locator('[data-section-row]').first()).toContainText('0:01.2');

  const persisted = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return {
      sectionCount: project.arrangementMap.sections.length,
      section: project.arrangementMap.sections[0],
      revisionLabels: project.revisions.map((revision) => revision.label),
    };
  });
  expect(persisted.sectionCount).toBe(1);
  expect(persisted.section.kind).toBe('chorus');
  expect(persisted.section.startSeconds).toBe(1);
  expect(persisted.section.endSeconds).toBe(1.2);
  expect(persisted.section.timingStatus).toBe('confirmed');
  expect(persisted.revisionLabels.some((label) => /Refrão atualizado na timeline/.test(label))).toBe(true);

  await page.locator('[data-section-remove]').first().click();
  await expect(page.locator('[data-section-row]')).toHaveCount(0);
  await expect(page.getByText(/Nenhuma seção marcada ainda/)).toBeVisible();
  const remaining = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const project = await storage.getProject(storage.activeProjectSessionId());
    return {
      sections: project.arrangementMap.sections.length,
      removedRevision: project.revisions.some((revision) => /Refrão removido da timeline/.test(revision.label)),
    };
  });
  expect(remaining.sections).toBe(0);
  expect(remaining.removedRevision).toBe(true);
  expect(unexpectedErrors(errors)).toEqual([]);
});

test('WEB RECORDING GATE: real MediaRecorder path creates a Studio track', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForHydratedShell(page);
  await page.locator('[data-action="record"]').first().click();
  await expect(page.getByRole('heading', { name: 'Gravando voz' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.locator('[data-action="stop-record"]').click();
  await expect(page.getByText('Gravação pronta no Studio.')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#waveform')).toBeVisible();
  await page.locator('[data-action="studio-tab"][data-value="voice"]').click();
  await expect(page.locator('[data-action="effect"][data-value="clean"]')).toBeVisible();
  expect(unexpectedErrors(errors)).toEqual([]);
});

test('WEB MOBILE GATE: Android-sized viewport boots and navigates without overflow failure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = captureErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForHydratedShell(page);
  await expect(page.getByRole('heading', { name: /Você tá no estúdio/i })).toBeVisible();
  await page.locator('[data-route="studio"]').first().click();
  await expect(page.getByText(/Primeiro, uma ideia|Studio/i).first()).toBeVisible();
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 2);
  expect(unexpectedErrors(errors)).toEqual([]);
});

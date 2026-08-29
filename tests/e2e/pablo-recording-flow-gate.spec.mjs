import { test, expect } from '@playwright/test';

async function waitForHydratedShell(page) {
  await expect(page.locator('.pv-nav')).toBeVisible({ timeout: 10_000 });
}

function captureErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

function unexpectedErrors(errors) {
  return errors.filter((message) =>
    !/favicon/i.test(message) &&
    !/Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element/i.test(message)
  );
}

async function recordingState(page, projectName = 'Gate Gravação Web') {
  return page.evaluate(async (name) => {
    const request = indexedDB.open('pablovoice_mobile_v2', 3);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const projects = await new Promise((resolve, reject) => {
      const read = db.transaction('projects', 'readonly').objectStore('projects').getAll();
      read.onsuccess = () => resolve(read.result || []);
      read.onerror = () => reject(read.error);
    });
    const project = projects.find((candidate) => candidate.name === name);
    const recording = project?.tracks?.find((track) => track.kind === 'recording');
    const asset = recording?.assetId ? await new Promise((resolve, reject) => {
      const read = db.transaction('audio', 'readonly').objectStore('audio').get(recording.assetId);
      read.onsuccess = () => resolve(read.result || null);
      read.onerror = () => reject(read.error);
    }) : null;
    db.close();
    return {
      projectId: project?.id || null,
      revisionCount: project?.revisions?.length || 0,
      trackCount: project?.tracks?.length || 0,
      recordingName: recording?.name || null,
      recordingKind: recording?.kind || null,
      recordingDuration: Number(recording?.duration || 0),
      recordingSampleRate: Number(recording?.sampleRate || 0),
      recordingChannels: Number(recording?.channels || 0),
      assetName: asset?.name || null,
      assetType: asset?.type || null,
      assetSize: Number(asset?.blob?.size || 0),
    };
  }, projectName);
}

test('WEB RECORDING FLOW GATE: microphone recording becomes a persisted recording track after reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);

  await page.addInitScript(() => {
    function wavBlob({ seconds = 0.7, sampleRate = 44100, frequency = 196 } = {}) {
      const samples = Math.floor(seconds * sampleRate);
      const buffer = new ArrayBuffer(44 + samples * 2);
      const view = new DataView(buffer);
      const writeString = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
      };
      writeString(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); writeString(8, 'WAVE');
      writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      writeString(36, 'data'); view.setUint32(40, samples * 2, true);
      for (let index = 0; index < samples; index += 1) {
        const edge = Math.min(1, index / 800, (samples - index) / 800);
        const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.22 * Math.max(0, edge);
        view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }

    const stoppedTracks = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        async getUserMedia(constraints) {
          window.__pabloVoiceRecordingConstraints = constraints;
          return { getTracks: () => [{ stop: () => stoppedTracks.push(Date.now()) }] };
        },
      },
    });

    class FakeMediaRecorder {
      static isTypeSupported() { return false; }
      constructor(stream) {
        this.stream = stream;
        this.state = 'inactive';
        this.mimeType = 'audio/wav';
        this.ondataavailable = null;
        this.onstop = null;
        this.onerror = null;
        this._sent = false;
      }
      start() { this.state = 'recording'; }
      requestData() {
        if (this._sent) return;
        this._sent = true;
        this.ondataavailable?.({ data: wavBlob() });
      }
      stop() {
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
    window.__pabloVoiceStoppedTracks = stoppedTracks;
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForHydratedShell(page);

  await page.locator('[data-action="new-project"]').first().click();
  await page.locator('[data-form="new-project"] input[name="name"]').fill('Gate Gravação Web');
  await page.locator('[data-form="new-project"]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name: 'Gate Gravação Web' })).toBeVisible();

  await page.locator('[data-action="record"]').first().click();
  await expect(page.locator('[data-action="stop-record"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#record-clock')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__pabloVoiceRecordingConstraints?.audio?.channelCount)).toBe(1);

  await page.locator('[data-action="stop-record"]').click();
  await expect(page.getByText('Gravação pronta no Studio.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^voz-\d{4}-\d{2}-\d{2}/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#waveform')).toBeVisible();
  await expect(page.locator('[data-action="play"]')).toBeVisible();

  const afterRecord = await recordingState(page);
  expect(afterRecord.trackCount).toBe(1);
  expect(afterRecord.recordingKind).toBe('recording');
  expect(afterRecord.recordingName).toMatch(/^voz-\d{4}-\d{2}-\d{2}/);
  expect(afterRecord.recordingDuration).toBeGreaterThan(0.5);
  expect(afterRecord.recordingSampleRate).toBe(44100);
  expect(afterRecord.recordingChannels).toBe(1);
  expect(afterRecord.assetType).toBe('audio/wav');
  expect(afterRecord.assetSize).toBeGreaterThan(44);
  expect(await page.evaluate(() => window.__pabloVoiceStoppedTracks.length)).toBe(1);

  await page.locator('[data-action="save"]').click();
  await expect(page.getByText('Projeto salvo neste aparelho.')).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await waitForHydratedShell(page);
  await page.locator('[data-route="projects"]').first().click();
  await expect(page.getByText('Gate Gravação Web').first()).toBeVisible();
  await page.locator('[data-action="open-project"]').first().click();
  await expect(page.getByRole('heading', { name: 'Gate Gravação Web' })).toBeVisible();
  await expect(page.getByText(afterRecord.recordingName).first()).toBeVisible();

  const afterReload = await recordingState(page);
  expect(afterReload.projectId).toBe(afterRecord.projectId);
  expect(afterReload.trackCount).toBe(1);
  expect(afterReload.recordingKind).toBe('recording');
  expect(afterReload.recordingName).toBe(afterRecord.recordingName);
  expect(afterReload.assetType).toBe('audio/wav');
  expect(afterReload.assetSize).toBe(afterRecord.assetSize);
  expect(afterReload.revisionCount).toBeGreaterThanOrEqual(afterRecord.revisionCount);

  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('#current-time')).not.toHaveText('0:00.0');
  await page.locator('[data-action="stop"]').click();

  expect(unexpectedErrors(errors)).toEqual([]);
});

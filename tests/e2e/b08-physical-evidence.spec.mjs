import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('test-results/b08-physical');

function staticTrack(track) {
  const { regionAutomation, ...rest } = track;
  return rest;
}

function preservedState(project) {
  return {
    id: project.id,
    name: project.name,
    lyrics: project.lyrics,
    notes: project.notes,
    preset: project.preset,
    activeTrackId: project.activeTrackId,
    trackOrder: project.tracks.map((track) => track.id),
    assetIds: project.tracks.map((track) => track.assetId),
    staticTracks: project.tracks.map(staticTrack),
  };
}

test('B08 renders frozen macro-arrangement through PabloAudioEngine', async ({ page }) => {
  test.setTimeout(180_000);
  await fs.mkdir(OUT, { recursive: true });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });

  const evidence = await page.evaluate(async () => {
    const [{ PabloAudioEngine }] = await Promise.all([
      import('/audio-engine.mjs'),
      import('/audio/src/presets.mjs'),
    ]);
    const plan = await fetch('/__b08/arrangement-change.json', { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`plan_http_${response.status}`);
      return response.json();
    });
    const fetchBlob = async (name) => {
      const response = await fetch(`/__b08/${name}.flac`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${name}_http_${response.status}`);
      return response.blob();
    };

    const engine = new PabloAudioEngine();
    const leadBlob = await fetchBlob('lead');
    const instrumentalBlob = await fetchBlob('instrumental');
    const [leadDecoded, instrumentalDecoded] = await Promise.all([
      engine.decode('lead', leadBlob),
      engine.decode('instrumental', instrumentalBlob),
    ]);

    const neutralEffects = {
      clean: false,
      warm: false,
      presence: false,
      normalize: false,
      compressor: false,
      deEsser: false,
      saturation: 0,
      lowEq: 0,
      midEq: 0,
      highEq: 0,
      pitchSemitones: 0,
      double: false,
      fadeIn: 0,
      fadeOut: 0,
    };
    const makeTrack = ({ id, assetId, name, duration, muted = false }) => ({
      id,
      assetId,
      name,
      type: 'audio/flac',
      kind: id === 'lead' ? 'vocal_main' : id === 'instrumental' ? 'instrumental' : 'reference',
      duration,
      sampleRate: 48000,
      channels: 2,
      offset: 0,
      trimStart: 0,
      trimEnd: duration,
      gain: 1,
      pan: 0,
      muted,
      solo: false,
      effects: { ...neutralEffects },
      regionAutomation: [],
    });

    const duration = Number(plan.reference.duration_seconds);
    const before = {
      schemaVersion: 9,
      id: 'b08_frozen_edit_reference',
      name: 'PabloVoice B08 frozen edit reference',
      createdAt: 1,
      updatedAt: 1,
      activeTrackId: 'lead',
      tracks: [
        makeTrack({ id: 'lead', assetId: '4fc561df-9ac8-4b69-9e59-381d8f15a907', name: 'Pablo Voice reference lead', duration: leadDecoded.buffer.duration }),
        makeTrack({ id: 'instrumental', assetId: plan.reference.instrumental_asset_id, name: 'Frozen reference instrumental', duration }),
        makeTrack({ id: 'master', assetId: 'b8212b7b-8a93-4dd0-b6c9-9f008c403f3c', name: 'Frozen reference master', duration, muted: true }),
      ],
      lyrics: 'B08_FROZEN_LYRICS_SENTINEL',
      notes: 'deterministic_b08_edit_reference_fixture_v1',
      preset: 'music',
      authorialMemory: null,
      revisions: [],
    };
    const after = structuredClone(before);
    const target = after.tracks.find((track) => track.id === 'instrumental');
    target.regionAutomation = plan.regions.map((region) => ({
      id: region.id,
      kind: 'gain',
      label: region.label,
      startSeconds: region.start_seconds,
      endSeconds: region.end_seconds,
      gainDb: region.gain_db,
      confidence: 1,
      source: plan.policy.source,
      enabled: true,
    }));

    const preservationBefore = JSON.stringify({
      id: before.id,
      name: before.name,
      lyrics: before.lyrics,
      notes: before.notes,
      preset: before.preset,
      activeTrackId: before.activeTrackId,
      trackOrder: before.tracks.map((track) => track.id),
      assetIds: before.tracks.map((track) => track.assetId),
      staticTracks: before.tracks.map(({ regionAutomation, ...rest }) => rest),
    });
    const preservationAfter = JSON.stringify({
      id: after.id,
      name: after.name,
      lyrics: after.lyrics,
      notes: after.notes,
      preset: after.preset,
      activeTrackId: after.activeTrackId,
      trackOrder: after.tracks.map((track) => track.id),
      assetIds: after.tracks.map((track) => track.assetId),
      staticTracks: after.tracks.map(({ regionAutomation, ...rest }) => rest),
    });
    if (preservationBefore !== preservationAfter) throw new Error('project_preservation_failed_before_render');
    const afterBeforeRender = JSON.stringify(after);

    const baseline = await engine.renderTrack(before, 'instrumental', 'music');
    const processed = await engine.renderTrack(after, 'instrumental', 'music');
    const processedMix = await engine.render(after, 'music');
    if (JSON.stringify(after) !== afterBeforeRender) throw new Error('audio_engine_mutated_project');

    const rms = (buffer, startSeconds, endSeconds) => {
      const start = Math.max(0, Math.floor(startSeconds * buffer.sampleRate));
      const end = Math.min(buffer.length, Math.ceil(endSeconds * buffer.sampleRate));
      let sum = 0;
      let count = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = start; index < end; index += 1) {
          sum += data[index] * data[index];
          count += 1;
        }
      }
      return count ? Math.sqrt(sum / count) : 0;
    };
    const regionMetrics = plan.regions.map((region) => {
      const guard = Math.min(0.05, Math.max(0, (region.end_seconds - region.start_seconds) / 20));
      const a = rms(baseline, region.start_seconds + guard, region.end_seconds - guard);
      const b = rms(processed, region.start_seconds + guard, region.end_seconds - guard);
      const measuredGainDb = a > 1e-9 && b > 1e-12 ? 20 * Math.log10(b / a) : null;
      return {
        id: region.id,
        target_gain_db: region.gain_db,
        measured_gain_db: measuredGainDb,
        baseline_rms: a,
        processed_rms: b,
        absolute_error_db: measuredGainDb == null ? null : Math.abs(measuredGainDb - region.gain_db),
      };
    });

    const boundaries = plan.regions.flatMap((region) => [region.start_seconds, region.end_seconds]);
    const insideOrEdge = (seconds) => plan.regions.some((region) => seconds >= region.start_seconds - 0.02 && seconds <= region.end_seconds + 0.02);
    let maxOutsideDelta = 0;
    let outsideRmsDeltaSum = 0;
    let outsideCount = 0;
    for (let channel = 0; channel < baseline.numberOfChannels; channel += 1) {
      const a = baseline.getChannelData(channel);
      const b = processed.getChannelData(channel);
      const length = Math.min(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        const seconds = index / baseline.sampleRate;
        if (insideOrEdge(seconds)) continue;
        const delta = Math.abs(a[index] - b[index]);
        maxOutsideDelta = Math.max(maxOutsideDelta, delta);
        outsideRmsDeltaSum += delta * delta;
        outsideCount += 1;
      }
    }
    const outsideRmsDelta = outsideCount ? Math.sqrt(outsideRmsDeltaSum / outsideCount) : 0;

    const allRegionsMeasured = regionMetrics.every((metric) => metric.measured_gain_db != null && metric.absolute_error_db <= 0.12);
    const acousticGuards = {
      all_regions_match_frozen_gain_within_0_12_db: allRegionsMeasured,
      outside_regions_max_abs_delta_le_1e_5: maxOutsideDelta <= 1e-5,
      duration_equal: baseline.length === processed.length && baseline.sampleRate === processed.sampleRate,
    };
    if (!Object.values(acousticGuards).every(Boolean)) throw new Error(`b08_acoustic_guard_failed:${JSON.stringify({ regionMetrics, maxOutsideDelta, acousticGuards })}`);

    window.__b08Buffers = { processed, processedMix };
    return {
      schema: 'pablovoice_b08_physical_evidence_v1',
      benchmark: plan.benchmark,
      scope: plan.scope,
      plan_source: 'benchmarks/assets/arrangement-change.json',
      snapshot_source: 'deterministic_b08_edit_reference_fixture_v1',
      target_track_id: 'instrumental',
      target_asset_id: plan.reference.instrumental_asset_id,
      lead_track_id: 'lead',
      lead_asset_id: '4fc561df-9ac8-4b69-9e59-381d8f15a907',
      reference_master_asset_id: 'b8212b7b-8a93-4dd0-b6c9-9f008c403f3c',
      engine_module: 'packages/app/audio-engine.mjs',
      render_method: 'PabloAudioEngine.renderTrack + PabloAudioEngine.render',
      preset: 'music',
      output_sample_rate: processed.sampleRate,
      output_channels: processed.numberOfChannels,
      output_frames: processed.length,
      output_duration_seconds: processed.duration,
      mix_sample_rate: processedMix.sampleRate,
      mix_channels: processedMix.numberOfChannels,
      mix_frames: processedMix.length,
      mix_duration_seconds: processedMix.duration,
      decoded_source: {
        lead_duration_seconds: leadDecoded.buffer.duration,
        lead_channels: leadDecoded.buffer.numberOfChannels,
        instrumental_duration_seconds: instrumentalDecoded.buffer.duration,
        instrumental_channels: instrumentalDecoded.buffer.numberOfChannels,
      },
      regions: regionMetrics,
      non_target_audio: {
        max_abs_delta_outside_regions_and_20ms_edges: maxOutsideDelta,
        rms_delta_outside_regions_and_20ms_edges: outsideRmsDelta,
      },
      project_preservation: {
        preserved_except_target_region_automation: preservationBefore === preservationAfter,
        engine_did_not_mutate_input_project: JSON.stringify(after) === afterBeforeRender,
        lead_not_targeted: after.tracks.find((track) => track.id === 'lead').regionAutomation.length === 0,
        lyrics_identical: before.lyrics === after.lyrics,
        track_order_identical: JSON.stringify(before.tracks.map((track) => track.id)) === JSON.stringify(after.tracks.map((track) => track.id)),
        asset_ids_identical: JSON.stringify(before.tracks.map((track) => track.assetId)) === JSON.stringify(after.tracks.map((track) => track.assetId)),
        duration_identical: before.tracks.find((track) => track.id === 'instrumental').duration === after.tracks.find((track) => track.id === 'instrumental').duration,
      },
      acoustic_guards: acousticGuards,
      scoring_state: 'physical_output_retained_pending_review',
    };
  });

  for (const [key, filename] of [
    ['processed', 'b08-instrumental-processed.wav'],
    ['processedMix', 'b08-mix-processed.wav'],
  ]) {
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async ({ key, filename }) => {
      const { encodeWav } = await import('/audio/src/presets.mjs');
      const buffer = window.__b08Buffers[key];
      const wav = encodeWav(buffer);
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, { key, filename });
    const download = await downloadPromise;
    await download.saveAs(path.join(OUT, filename));
  }

  await fs.writeFile(path.join(OUT, 'measurement.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(evidence.project_preservation.preserved_except_target_region_automation).toBe(true);
  expect(evidence.project_preservation.engine_did_not_mutate_input_project).toBe(true);
  expect(evidence.project_preservation.lead_not_targeted).toBe(true);
  expect(evidence.acoustic_guards.all_regions_match_frozen_gain_within_0_12_db).toBe(true);
  expect(evidence.acoustic_guards.outside_regions_max_abs_delta_le_1e_5).toBe(true);
  expect(evidence.acoustic_guards.duration_equal).toBe(true);
});

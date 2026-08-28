import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('canonical boot installs read-only restoration recommendation before scan and cleanup writers', async () => {
  const preboot = await read('packages/app/preboot.mjs');
  assert.match(preboot, /pablo-section-vocal-restoration-recommendation-adapter\.mjs/);
  assert.match(preboot, /installPabloSectionVocalRestorationRecommendationAdapter\(\)/);
  const recommendationIndex = preboot.indexOf('installPabloSectionVocalRestorationRecommendationAdapter();');
  const scanIndex = preboot.indexOf('installPabloSectionVocalScanAdapter();');
  const cleanupIndex = preboot.indexOf('installPabloSectionVocalCleanupAdapter();');
  assert.ok(recommendationIndex > 0 && recommendationIndex < scanIndex && scanIndex < cleanupIndex);
});

test('recommendation reuses canonical analyzer and cleanup planner and never persists or mutates project storage', async () => {
  const [adapter, core] = await Promise.all([
    read('packages/app/pablo-section-vocal-restoration-recommendation-adapter.mjs'),
    read('packages/core/src/section-vocal-restoration-recommendation.mjs'),
  ]);
  assert.match(adapter, /analyzeAudioTrack\(target\.track\)/);
  assert.doesNotMatch(adapter, /saveProject|snapshotProject|regionAutomation\s*=/);
  assert.match(core, /planSectionVocalCleanup/);
  assert.match(core, /restoration\.windows/);
  assert.match(core, /timbreGuard/);
  assert.match(core, /diagnostic_only_no_automatic_notch/);
});

test('recommendation explains guardrails instead of inventing a dedicated hum notch or remote provider', async () => {
  const [adapter, core] = await Promise.all([
    read('packages/app/pablo-section-vocal-restoration-recommendation-adapter.mjs'),
    read('packages/core/src/section-vocal-restoration-recommendation.mjs'),
  ]);
  assert.match(adapter, /pitch e formantes preservados/);
  assert.match(adapter, /não autorização para um notch automático/);
  assert.match(core, /pitchPreserving/);
  assert.match(core, /formantPreserving/);
  assert.match(core, /maxNoiseReductionDb/);
  assert.match(core, /maxDereverbAmount/);
  assert.doesNotMatch(`${adapter}\n${core}`, /fetch\(|provider|service-role|notch.*kind|BiquadFilter/);
});

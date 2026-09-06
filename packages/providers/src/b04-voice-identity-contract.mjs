export const B04_FROZEN = Object.freeze({
  projectId: 'd64e4de9-791e-41bc-9307-7957389b2499',
  guideAssetId: '549ff71f-7cce-414d-a77d-7021a7fc208e',
  guideSha256: 'ac5a5e63f5f263f8a083ad7942229cb5cd546f627033a1de61148e355ef40816',
  frozenSourceSha256: 'ff57cb304fbe72783b78ab5f43137cd3daba2736e76135d86beb0e1f8f0e6e2d',
  identityReferenceSha256: '5d02cef6ddb423f95485f2f202dba0c1634ab7a001307743f631f5078a2f1439',
  voiceModelId: '5c0976b2-bd2c-44d7-8720-a2dc013fd4b5',
  modelPthSha256: '58f0354124a4a18a0a5bd1f8c74bd95b6147713dcb23b98d9060a5bc63bda56a',
  modelIndexSha256: '814feab12db225c2e1e0a43a661238dc587a7d1554343ca7223103be16fd930f',
  regionStartSeconds: 64,
  regionEndSeconds: 72,
  profile: 'identity',
  recipe: Object.freeze({
    pitch: 0,
    index_rate: 0.70,
    protect: 0.50,
    f0_method: 'rmvpe',
    embedder_model: 'contentvec',
    split_audio: true,
    f0_autotune: false,
    clean_audio: false,
    formant_shifting: false,
  }),
  applioCommit: '085197e738ce9dd4c0bae1e0a74df5de25b89444',
});

export function buildB04DispatchRequest(overrides = {}) {
  const request = {
    action: 'dispatch',
    project_id: overrides.projectId ?? B04_FROZEN.projectId,
    profile: overrides.profile ?? B04_FROZEN.profile,
    guide_asset_id: overrides.guideAssetId ?? B04_FROZEN.guideAssetId,
    expected_guide_sha256: overrides.guideSha256 ?? B04_FROZEN.guideSha256,
    region_start_seconds: overrides.regionStartSeconds ?? B04_FROZEN.regionStartSeconds,
    region_end_seconds: overrides.regionEndSeconds ?? B04_FROZEN.regionEndSeconds,
    identity_reference_sha256: overrides.identityReferenceSha256 ?? B04_FROZEN.identityReferenceSha256,
    required_voice_model_id: overrides.voiceModelId ?? B04_FROZEN.voiceModelId,
    required_model_pth_sha256: overrides.modelPthSha256 ?? B04_FROZEN.modelPthSha256,
    required_model_index_sha256: overrides.modelIndexSha256 ?? B04_FROZEN.modelIndexSha256,
    benchmark_case: 'B04',
  };
  assertFrozenB04Request(request);
  return Object.freeze(request);
}

export function assertFrozenB04Request(request) {
  const exact = {
    project_id: B04_FROZEN.projectId,
    profile: B04_FROZEN.profile,
    guide_asset_id: B04_FROZEN.guideAssetId,
    expected_guide_sha256: B04_FROZEN.guideSha256,
    identity_reference_sha256: B04_FROZEN.identityReferenceSha256,
    required_voice_model_id: B04_FROZEN.voiceModelId,
    required_model_pth_sha256: B04_FROZEN.modelPthSha256,
    required_model_index_sha256: B04_FROZEN.modelIndexSha256,
    benchmark_case: 'B04',
  };
  for (const [key, value] of Object.entries(exact)) {
    if (request?.[key] !== value) throw new Error(`B04 contract: ${key} changed.`);
  }
  if (Number(request?.region_start_seconds) !== B04_FROZEN.regionStartSeconds || Number(request?.region_end_seconds) !== B04_FROZEN.regionEndSeconds) {
    throw new Error('B04 contract: frozen 64-72 second region changed.');
  }
  return true;
}

export function evaluateB04RetainedEvidence(evidence = {}) {
  const failures = [];
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  expect(evidence.retained === true, 'output_not_retained');
  expect(evidence.private === true, 'output_not_private');
  expect(evidence.profile === B04_FROZEN.profile, 'profile_mismatch');
  expect(evidence.guideSha256 === B04_FROZEN.guideSha256, 'guide_hash_mismatch');
  expect(evidence.identityReferenceSha256 === B04_FROZEN.identityReferenceSha256, 'identity_reference_mismatch');
  expect(evidence.modelPthSha256 === B04_FROZEN.modelPthSha256, 'pth_hash_mismatch');
  expect(evidence.modelIndexSha256 === B04_FROZEN.modelIndexSha256, 'index_hash_mismatch');
  expect(Number(evidence.regionStartSeconds) === 64 && Number(evidence.regionEndSeconds) === 72, 'region_mismatch');
  expect(/^[0-9a-f]{64}$/i.test(String(evidence.outputSha256 || '')), 'output_hash_missing');
  expect(evidence.outputSha256 !== evidence.guideSha256, 'neural_output_not_proven');
  expect(evidence.outputPcmSha256 && evidence.outputPcmSha256 !== evidence.guidePcmSha256, 'neural_pcm_not_proven');
  const duration = Number(evidence.durationSeconds);
  expect(Number.isFinite(duration) && duration >= 7.5 && duration <= 8.5, 'localized_duration_invalid');
  return Object.freeze({ valid: failures.length === 0, failures: Object.freeze(failures) });
}

export function classifyB04Readiness({
  authenticatedDispatcher = false,
  exactGuideGuard = false,
  localizedRegionGuard = false,
  identityReferenceGuard = false,
  modelHashGuard = false,
  retainedBenchmarkOutput = false,
} = {}) {
  const implementationReady = [authenticatedDispatcher, exactGuideGuard, localizedRegionGuard, identityReferenceGuard, modelHashGuard].every(Boolean);
  return Object.freeze({
    implementationReady,
    retainedBenchmarkOutput: retainedBenchmarkOutput === true,
    scorable: implementationReady && retainedBenchmarkOutput === true,
    state: implementationReady
      ? retainedBenchmarkOutput === true ? 'evidence_ready' : 'implementation_ready_unexecuted'
      : 'blocked',
  });
}

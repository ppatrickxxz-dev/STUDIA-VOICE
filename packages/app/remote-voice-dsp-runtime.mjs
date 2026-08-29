import { RemoteAuthAdapter, REMOTE_ENDPOINTS } from './remote-auth.mjs';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PROJECT_URL = REMOTE_ENDPOINTS.project;
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const HARMONY_ENDPOINT = `${PROJECT_URL}/functions/v1/progress-kaggle-harmony-v73`;
const PITCH_ENDPOINT = `${PROJECT_URL}/functions/v1/diagnose-voice-v70-once`;

export const REMOTE_VOICE_DSP_CONTRACT = Object.freeze({
  version: 'voice-dsp-runtime-v1',
  harmony: Object.freeze({
    endpoint: 'progress-kaggle-harmony-v73',
    mode: 'adaptive_partial',
    voices: Object.freeze(['high', 'low']),
    pairMustBeExecutedSequentially: true,
    explicitSourceSupported: true,
  }),
  pitch: Object.freeze({
    endpoint: 'diagnose-voice-v70-once',
    sourceAssetRequired: true,
    noteAware: true,
  }),
  benchmarkPromotion: 'external_acoustic_evidence_only',
});

function defaultFetch() {
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
}

function headers(accessToken) {
  return {
    apikey: PUBLISHABLE_KEY,
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  };
}

function normalizeTargets(targets = []) {
  return targets.map((target) => ({
    start: Number(target?.start),
    end: Number(target?.end),
    target_midi: Number(target?.targetMidi ?? target?.target_midi),
  })).filter((target) => Number.isFinite(target.start)
    && Number.isFinite(target.end)
    && target.end > target.start
    && Number.isFinite(target.target_midi)
    && target.target_midi >= 24
    && target.target_midi <= 108);
}

export class RemoteVoiceDspRuntime {
  constructor({ authAdapter = new RemoteAuthAdapter(), fetchImpl = defaultFetch() } = {}) {
    this.auth = authAdapter;
    this.fetch = fetchImpl;
  }

  async resolveContext(localProject) {
    if (typeof this.fetch !== 'function') throw new Error('Remote voice DSP transport unavailable.');
    const session = await this.auth.ensureSession();
    if (!session?.accessToken) throw new Error('Authenticated PabloVoice session required.');
    const linked = await this.auth.ensureRemoteProject(localProject);
    const projectId = String(linked?.project?.id || '');
    if (!linked?.ok || !UUID_RE.test(projectId)) throw new Error('Remote project link required.');
    return { accessToken: session.accessToken, projectId };
  }

  async dispatchHarmony({ localProject, voice, sourceAssetId = null } = {}) {
    if (!REMOTE_VOICE_DSP_CONTRACT.harmony.voices.includes(voice)) throw new Error('Harmony voice must be high or low.');
    if (sourceAssetId !== null && !UUID_RE.test(String(sourceAssetId))) throw new Error('Verified remote sourceAssetId is required when an explicit harmony source is requested.');
    const { accessToken, projectId } = await this.resolveContext(localProject);
    const request = {
      action: 'dispatch',
      project_id: projectId,
      voice,
      mode: REMOTE_VOICE_DSP_CONTRACT.harmony.mode,
    };
    if (sourceAssetId) request.source_asset_id = sourceAssetId;
    const data = await this.#request(HARMONY_ENDPOINT, accessToken, request);
    if (!data?.ok || !UUID_RE.test(String(data.job_id || ''))) throw new Error(data?.error || 'Harmony dispatch failed.');
    return this.#executionOnly('B07', data, { projectId, voice, sourceAssetId, mode: REMOTE_VOICE_DSP_CONTRACT.harmony.mode });
  }

  async harmonyStatus({ localProject, sync = false } = {}) {
    const { accessToken, projectId } = await this.resolveContext(localProject);
    const data = await this.#request(HARMONY_ENDPOINT, accessToken, {
      action: sync ? 'sync' : 'status',
      project_id: projectId,
    });
    return this.#executionOnly('B07', data, { projectId });
  }

  async dispatchPitchCorrection({ localProject, sourceAssetId, explicitTargets = [] } = {}) {
    if (!UUID_RE.test(String(sourceAssetId || ''))) throw new Error('Verified remote sourceAssetId is required for pitch correction.');
    const targets = normalizeTargets(explicitTargets);
    if (targets.length !== explicitTargets.length) throw new Error('Invalid explicit target note region.');
    const { accessToken, projectId } = await this.resolveContext(localProject);
    const data = await this.#request(PITCH_ENDPOINT, accessToken, {
      action: 'dispatch',
      project_id: projectId,
      source_asset_id: sourceAssetId,
      explicit_targets: targets,
    });
    if (!data?.ok || !UUID_RE.test(String(data.job_id || ''))) throw new Error(data?.error || 'Pitch correction dispatch failed.');
    return this.#executionOnly('B06', data, { projectId, sourceAssetId });
  }

  async pitchStatus({ localProject, sync = false } = {}) {
    const { accessToken, projectId } = await this.resolveContext(localProject);
    const data = await this.#request(PITCH_ENDPOINT, accessToken, {
      action: sync ? 'sync' : 'status',
      project_id: projectId,
    });
    return this.#executionOnly('B06', data, { projectId });
  }

  async #request(url, accessToken, body) {
    const response = await this.fetch(url, {
      method: 'POST',
      headers: headers(accessToken),
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.human_message || data?.error || `voice_dsp_${response.status}`));
    return data;
  }

  #executionOnly(benchmark, data, context) {
    return Object.freeze({
      ok: data?.ok === true,
      benchmark,
      execution: data,
      context,
      benchmarkPass: false,
      benchmarkState: 'execution_evidence_pending_review',
      promotionRequires: 'retained output hashes + acoustic evidence gate',
    });
  }
}

export function installRemoteVoiceDspRuntime({ runtime = new RemoteVoiceDspRuntime(), target = globalThis } = {}) {
  if (!target || target.PabloVoiceVoiceDSP) return target?.PabloVoiceVoiceDSP || runtime;
  const api = Object.freeze({
    contract: REMOTE_VOICE_DSP_CONTRACT,
    dispatchHarmony: (request) => runtime.dispatchHarmony(request),
    harmonyStatus: (request) => runtime.harmonyStatus(request),
    dispatchPitchCorrection: (request) => runtime.dispatchPitchCorrection(request),
    pitchStatus: (request) => runtime.pitchStatus(request),
  });
  target.PabloVoiceVoiceDSP = api;
  return api;
}

if (typeof window !== 'undefined') installRemoteVoiceDspRuntime({ target: window });

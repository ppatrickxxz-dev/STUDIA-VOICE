const UUID_RE = /^[0-9a-f-]{36}$/i;

export const PITCH_CORRECTION_B06_ROUTE = Object.freeze({
  endpoint: 'diagnose-voice-v70-once',
  legacySlotReused: true,
  legacySlotReason: 'Former one-shot voice-v70 diagnostic was already consumed and disabled; reused to stay within Supabase free-tier Edge Function limit.',
  deployedFunctionSha256: 'f008b139bc9e4022f497e04c3a52fd91e7d4a9ba3e16ddb32962e4fb2b1fbca1',
  engine: 'Rubber Band + librosa pYIN',
  workerVersion: 'b06-1.0',
  policy: Object.freeze({
    min_event_seconds: 0.18,
    min_confidence: 0.72,
    deadband_cents: 12,
    max_correction_cents: 45,
    crossfade_seconds: 0.035,
    preserve_formants: true,
    preserve_relative_vibrato: true,
    target_strategy: 'explicit_or_nearest_chromatic',
  }),
  retainedBenchmarkOutput: null,
});

export class KagglePitchCorrectionClient {
  constructor({ supabaseUrl, publishableKey, endpointSlug = PITCH_CORRECTION_B06_ROUTE.endpoint, fetchImpl = globalThis.fetch } = {}) {
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/$/, '');
    this.publishableKey = String(publishableKey || '');
    this.endpointSlug = String(endpointSlug || PITCH_CORRECTION_B06_ROUTE.endpoint);
    this.fetch = fetchImpl;
  }

  async dispatch({ accessToken, projectId, sourceAssetId, explicitTargets = [] } = {}) {
    this.#validateRuntime(accessToken, projectId);
    if (!UUID_RE.test(String(sourceAssetId || ''))) throw new Error('Valid sourceAssetId is required.');
    const targets = normalizeTargets(explicitTargets);
    if (targets.length !== (explicitTargets || []).length) throw new Error('Invalid explicit target note region.');
    const payload = await this.#request(accessToken, {
      action: 'dispatch',
      project_id: projectId,
      source_asset_id: sourceAssetId,
      explicit_targets: targets,
    });
    if (!payload?.ok || !UUID_RE.test(String(payload.job_id || ''))) throw new Error(payload?.error || 'Pitch correction dispatcher returned an invalid job.');
    return payload;
  }

  async status({ accessToken, projectId } = {}) {
    this.#validateRuntime(accessToken, projectId);
    return this.#request(accessToken, { action: 'status', project_id: projectId });
  }

  async sync({ accessToken, projectId } = {}) {
    this.#validateRuntime(accessToken, projectId);
    return this.#request(accessToken, { action: 'sync', project_id: projectId });
  }

  #validateRuntime(accessToken, projectId) {
    if (!this.supabaseUrl || !this.publishableKey) throw new Error('Supabase runtime configuration is required.');
    if (!accessToken) throw new Error('Authenticated access token is required.');
    if (!UUID_RE.test(String(projectId || ''))) throw new Error('Valid projectId is required.');
    if (typeof this.fetch !== 'function') throw new Error('Fetch transport is unavailable.');
  }

  async #request(accessToken, body) {
    const response = await this.fetch(`${this.supabaseUrl}/functions/v1/${this.endpointSlug}`, {
      method: 'POST',
      headers: {
        apikey: this.publishableKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { error: text.slice(0, 500) }; }
    if (!response.ok) throw new Error(payload?.error || `Pitch correction request failed (${response.status}).`);
    return payload;
  }
}

export function classifyPitchCorrectionRouteReadiness(evidence = PITCH_CORRECTION_B06_ROUTE) {
  const implementationReady = evidence.policy?.preserve_formants === true
    && evidence.policy?.preserve_relative_vibrato === true
    && Number(evidence.policy?.max_correction_cents) <= 50
    && /^[0-9a-f]{64}$/i.test(String(evidence.deployedFunctionSha256 || ''));
  const retained = Boolean(evidence.retainedBenchmarkOutput?.verified);
  return Object.freeze({
    implementationReady,
    retainedBenchmarkOutput: retained,
    scorable: implementationReady && retained,
    state: implementationReady ? retained ? 'evidence_ready' : 'implementation_ready_unexecuted' : 'partial_non_promotable',
  });
}

function normalizeTargets(targets) {
  return (targets || []).map((target) => ({
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

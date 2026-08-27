const UUID_RE = /^[0-9a-f-]{36}$/i;

export const HARMONY_V752_ROUTE_EVIDENCE = Object.freeze({
  endpoint: 'progress-kaggle-harmony-v73',
  deployedFunctionSha256: 'b4dcc26669395ee4c9f07b8d525cf81805b2b6d75bbe7ab8a6a8a0134551def1',
  engine: 'Rubber Band + librosa',
  workerVersion: '7.5.2',
  modes: Object.freeze(['texture', 'adaptive', 'adaptive_partial']),
  voices: Object.freeze(['high', 'low']),
  formantPreservationRequired: true,
  observedHighExecution: Object.freeze({
    jobId: '022aee73-a3a2-4602-923d-5e054ede08ea',
    sourceSha256: '78b4c5e5728a8beb3b0e288699eb6aa5882e9ed580823a168c833bf9455701ac',
    outputSha256: 'd3898083ab24f0bf9d26ea9a3cb094333c140d15bb3ec67bc4be560c9737a0fe',
    mode: 'adaptive_partial',
    voice: 'high',
    verified: true,
  }),
  observedLowExecution: null,
});

export function buildHarmonyPairPlan({ mode = 'adaptive_partial' } = {}) {
  if (!HARMONY_V752_ROUTE_EVIDENCE.modes.includes(mode)) throw new Error(`Unsupported harmony mode: ${mode}`);
  return Object.freeze([
    Object.freeze({ voice: 'high', mode }),
    Object.freeze({ voice: 'low', mode }),
  ]);
}

export class KaggleHarmonyClient {
  constructor({ supabaseUrl, publishableKey, endpointSlug = HARMONY_V752_ROUTE_EVIDENCE.endpoint, fetchImpl = globalThis.fetch } = {}) {
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/$/, '');
    this.publishableKey = String(publishableKey || '');
    this.endpointSlug = String(endpointSlug || HARMONY_V752_ROUTE_EVIDENCE.endpoint);
    this.fetch = fetchImpl;
  }

  async dispatch({ accessToken, projectId, voice, mode = 'adaptive_partial', semitones = null } = {}) {
    this.#validateRuntime(accessToken, projectId);
    if (!HARMONY_V752_ROUTE_EVIDENCE.voices.includes(voice)) throw new Error('Harmony voice must be high or low.');
    if (!HARMONY_V752_ROUTE_EVIDENCE.modes.includes(mode)) throw new Error('Unsupported harmony mode.');

    const body = { action: 'dispatch', project_id: projectId, voice, mode };
    if (mode === 'texture' && Number.isFinite(Number(semitones))) body.semitones = Number(semitones);
    const payload = await this.#request(accessToken, body);
    if (!payload?.ok || !UUID_RE.test(String(payload.job_id || ''))) throw new Error(payload?.error || 'Harmony dispatcher returned an invalid job.');
    if (payload.mode !== mode || payload.voice !== voice) throw new Error('Harmony dispatcher changed the requested mode/voice.');
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
    if (!response.ok) throw new Error(payload?.error || `Harmony request failed (${response.status}).`);
    return payload;
  }
}

export function classifyHarmonyPairReadiness(evidence = HARMONY_V752_ROUTE_EVIDENCE) {
  const highValidated = evidence.observedHighExecution?.verified === true;
  const lowValidated = evidence.observedLowExecution?.verified === true;
  const routeImplemented = evidence.voices?.includes('high') && evidence.voices?.includes('low') && evidence.formantPreservationRequired === true;
  return Object.freeze({
    routeImplemented,
    highValidated,
    lowValidated,
    pairValidated: highValidated && lowValidated,
    implementationReady: routeImplemented,
    state: highValidated && lowValidated ? 'pair_validated' : routeImplemented ? 'pair_implemented_execution_pending' : 'incomplete',
  });
}

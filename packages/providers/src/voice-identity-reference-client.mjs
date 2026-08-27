const UUID_RE = /^[0-9a-f-]{36}$/i;

export class VoiceIdentityReferenceClient {
  constructor({ supabaseUrl, publishableKey, fetchImpl = globalThis.fetch } = {}) {
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/$/, '');
    this.publishableKey = String(publishableKey || '');
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind?.(globalThis) || fetchImpl : null;
  }

  async list({ accessToken } = {}) {
    this.#validateRuntime(accessToken);
    const models = await this.#get(accessToken, '/rest/v1/voice_models?select=id,name,engine,status,is_active,updated_at&status=eq.ready&order=is_active.desc,updated_at.desc&limit=20');
    const model = models.find((row) => row?.is_active) || models[0] || null;
    if (!model?.id) return Object.freeze({ voiceModel: null, reference: null, candidates: [] });

    const [references, candidates] = await Promise.all([
      this.#get(accessToken, `/rest/v1/voice_identity_references?select=id,voice_model_id,asset_id,source_sha256,label,is_active,created_at,updated_at&voice_model_id=eq.${encodeURIComponent(model.id)}&is_active=eq.true&order=updated_at.desc&limit=1`),
      this.#get(accessToken, '/rest/v1/audio_assets?select=id,kind,original_name,mime_type,size_bytes,duration_seconds,sample_rate,channels,sha256,created_at,metadata&kind=in.(take,source)&sha256=not.is.null&order=created_at.desc&limit=40'),
    ]);

    return Object.freeze({
      voiceModel: model,
      reference: references[0] || null,
      candidates: candidates.filter(isVerifiedCandidate).map(sanitizeCandidate),
    });
  }

  async set({ accessToken, voiceModelId, assetId, label = null } = {}) {
    this.#validateRuntime(accessToken);
    if (!UUID_RE.test(String(voiceModelId || ''))) throw new Error('Valid voiceModelId is required.');
    if (!UUID_RE.test(String(assetId || ''))) throw new Error('Valid assetId is required.');
    const data = await this.#post(accessToken, '/rest/v1/rpc/set_voice_identity_reference', {
      p_voice_model_id: voiceModelId,
      p_asset_id: assetId,
      p_label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 160) : null,
    });
    return Array.isArray(data) ? data[0] || null : data;
  }

  async clear({ accessToken, voiceModelId } = {}) {
    this.#validateRuntime(accessToken);
    if (!UUID_RE.test(String(voiceModelId || ''))) throw new Error('Valid voiceModelId is required.');
    return this.#post(accessToken, '/rest/v1/rpc/clear_voice_identity_reference', { p_voice_model_id: voiceModelId });
  }

  #validateRuntime(accessToken) {
    if (!this.supabaseUrl || !this.publishableKey) throw new Error('Supabase runtime configuration is required.');
    if (!accessToken) throw new Error('Authenticated access token is required.');
    if (typeof this.fetch !== 'function') throw new Error('Fetch transport is unavailable.');
  }

  #headers(accessToken) {
    return {
      apikey: this.publishableKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
  }

  async #get(accessToken, path) {
    const response = await this.fetch(`${this.supabaseUrl}${path}`, { headers: this.#headers(accessToken) });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(data?.message || data?.error || `identity_reference_get_${response.status}`);
    return Array.isArray(data) ? data : [];
  }

  async #post(accessToken, path, body) {
    const response = await this.fetch(`${this.supabaseUrl}${path}`, {
      method: 'POST',
      headers: this.#headers(accessToken),
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || data?.error || `identity_reference_post_${response.status}`);
    return data;
  }
}

function isVerifiedCandidate(asset) {
  return ['take', 'source'].includes(String(asset?.kind || '')) && /^[0-9a-f]{64}$/i.test(String(asset?.sha256 || ''));
}

function sanitizeCandidate(asset) {
  return Object.freeze({
    id: asset.id,
    kind: asset.kind,
    name: asset.original_name || 'Gravação de referência',
    mimeType: asset.mime_type || null,
    sizeBytes: Number(asset.size_bytes || 0) || null,
    durationSeconds: Number(asset.duration_seconds || 0) || null,
    sampleRate: Number(asset.sample_rate || 0) || null,
    channels: Number(asset.channels || 0) || null,
    sha256: String(asset.sha256 || '').toLowerCase(),
    createdAt: asset.created_at || null,
    source: asset?.metadata?.source || asset?.metadata?.client || null,
  });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SHA_RE = /^[0-9a-f]{64}$/i;

export class KaggleStemsClient {
  constructor({ supabaseUrl, publishableKey, dispatcherSlug = 'compute-kaggle-v54', fetchImpl = globalThis.fetch } = {}) {
    this.supabaseUrl = String(supabaseUrl || '').replace(/\/$/, '');
    this.publishableKey = String(publishableKey || '');
    this.dispatcherSlug = String(dispatcherSlug || 'compute-kaggle-v54');
    this.fetch = fetchImpl;
  }

  async dispatch({ accessToken, projectId, sourceAssetId = null } = {}) {
    if (!this.supabaseUrl || !this.publishableKey) throw new Error('Supabase runtime configuration is required.');
    if (!accessToken) throw new Error('Authenticated access token is required.');
    if (!UUID_RE.test(String(projectId || ''))) throw new Error('Valid projectId is required.');
    if (sourceAssetId && !UUID_RE.test(String(sourceAssetId))) throw new Error('Valid sourceAssetId is required.');

    const response = await this.fetch(`${this.supabaseUrl}/functions/v1/${this.dispatcherSlug}`, {
      method: 'POST',
      headers: {
        apikey: this.publishableKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project_id: projectId,
        ...(sourceAssetId ? { source_asset_id: sourceAssetId } : {}),
      }),
    });

    const payload = await parseJson(response);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || `Kaggle stems dispatch failed (${response.status}).`);
    if (!UUID_RE.test(String(payload.job_id || ''))) throw new Error('Dispatcher returned an invalid job id.');
    return {
      ok: true,
      jobId: payload.job_id,
      status: payload.status || null,
      progress: Number.isFinite(Number(payload.progress)) ? Number(payload.progress) : null,
      dispatcher: payload.dispatcher || this.dispatcherSlug,
      worker: payload.worker || null,
    };
  }

  async createTicket({ accessToken, projectId, sourceAssetId = null } = {}) {
    if (!this.supabaseUrl || !this.publishableKey) throw new Error('Supabase runtime configuration is required.');
    if (!accessToken) throw new Error('Authenticated access token is required.');
    if (!UUID_RE.test(String(projectId || ''))) throw new Error('Valid projectId is required.');

    const response = await this.fetch(`${this.supabaseUrl}/functions/v1/create-kaggle-ticket`, {
      method: 'POST',
      headers: {
        apikey: this.publishableKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project_id: projectId,
        job_type: 'stems',
        ...(sourceAssetId ? { source_asset_id: sourceAssetId } : {}),
      }),
    });

    const payload = await parseJson(response);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || `Kaggle ticket request failed (${response.status}).`);
    return validateIssuedStemsTicket(payload);
  }
}

export function validateIssuedStemsTicket(payload, nowSeconds = Math.floor(Date.now() / 1000)) {
  const ticket = payload?.ticket;
  if (!ticket || ticket.job_type !== 'stems') throw new Error('Invalid stems ticket response.');
  if (!UUID_RE.test(String(payload.job_id || ticket.job_id || ''))) throw new Error('Ticket job id is invalid.');
  if (!Number.isFinite(Number(ticket.expires_at)) || Number(ticket.expires_at) <= nowSeconds) throw new Error('Ticket is expired.');
  if (!isHttps(ticket.source_url) || !isHttps(ticket.complete_url) || !isHttps(ticket.supabase_url)) throw new Error('Ticket URLs must use HTTPS.');
  if (!SHA_RE.test(String(ticket.source_sha256 || ''))) throw new Error('Ticket source SHA-256 is invalid.');
  if (!ticket.outputs?.vocal?.bucket || !ticket.outputs?.vocal?.path || !ticket.outputs?.vocal?.token) throw new Error('Ticket vocal signed upload is incomplete.');
  if (!ticket.outputs?.instrumental?.bucket || !ticket.outputs?.instrumental?.path || !ticket.outputs?.instrumental?.token) throw new Error('Ticket instrumental signed upload is incomplete.');
  if (String(ticket.callback_token || '').length < 32) throw new Error('Ticket callback token is invalid.');
  if (ticket.profile?.name !== 'htdemucs') throw new Error('Unexpected stems profile.');

  return {
    ok: true,
    jobId: payload.job_id || ticket.job_id,
    expiresAt: Number(ticket.expires_at),
    provider: 'demucs',
    model: 'htdemucs',
    ticket,
  };
}

function isHttps(value) {
  try { return new URL(String(value)).protocol === 'https:'; }
  catch { return false; }
}

async function parseJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; }
  catch { return { error: text.slice(0, 500) }; }
}

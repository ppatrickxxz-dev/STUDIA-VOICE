const SHA256_RE = /^[a-f0-9]{64}$/i;

export function validateKaggleStemTicket(ticket, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!ticket || typeof ticket !== 'object') throw new TypeError('Kaggle stem ticket must be an object.');
  if (ticket.job_type !== 'stems') throw new Error('Kaggle ticket job_type must be stems.');
  if (!Number.isInteger(Number(ticket.expires_at)) || Number(ticket.expires_at) <= nowSeconds) throw new Error('Kaggle ticket is expired.');
  requireText(ticket.job_id, 'job_id');
  requireHttps(ticket.source_url, 'source_url');
  requireSha(ticket.source_sha256, 'source_sha256');
  requireHttps(ticket.complete_url, 'complete_url');
  requireText(ticket.callback_token, 'callback_token');
  requireHttps(ticket.supabase_url, 'supabase_url');
  requireText(ticket.supabase_publishable_key, 'supabase_publishable_key');

  const vocal = ticket.outputs?.vocal;
  const instrumental = ticket.outputs?.instrumental;
  validateOutput(vocal, 'outputs.vocal');
  validateOutput(instrumental, 'outputs.instrumental');

  return true;
}

export function normalizeKaggleStemCompletion(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('Kaggle completion payload must be an object.');
  requireSha(payload.source_sha256, 'source_sha256');
  requireSha(payload.vocal_sha256, 'vocal_sha256');
  requireSha(payload.instrumental_sha256, 'instrumental_sha256');
  if (payload.source_sha256 === payload.vocal_sha256 || payload.source_sha256 === payload.instrumental_sha256 || payload.vocal_sha256 === payload.instrumental_sha256) {
    throw new Error('Stem proof gate failed: hashes are not independent.');
  }

  const vocalBytes = positiveInteger(payload.vocal_size_bytes, 'vocal_size_bytes');
  const instrumentalBytes = positiveInteger(payload.instrumental_size_bytes, 'instrumental_size_bytes');
  if (Math.min(vocalBytes, instrumentalBytes) <= 4096) throw new Error('Stem proof gate failed: output is too small.');
  requireText(payload.demucs_version, 'demucs_version');

  return Object.freeze({
    provider: 'demucs',
    family: 'demucs',
    model: 'htdemucs',
    version: payload.demucs_version,
    mode: '2stem',
    evidence: {
      sourceSha256: payload.source_sha256.toLowerCase(),
      vocalSha256: payload.vocal_sha256.toLowerCase(),
      instrumentalSha256: payload.instrumental_sha256.toLowerCase(),
      vocalBytes,
      instrumentalBytes,
    },
    validatedOutput: true,
  });
}

export function kaggleDemucsProvider({ issueTicket, awaitCompletion, validated = false } = {}) {
  const operational = typeof issueTicket === 'function' && typeof awaitCompletion === 'function';
  return {
    id: 'demucs-kaggle-v2',
    family: 'demucs',
    model: 'htdemucs',
    version: '4.0.1+',
    available: operational,
    validated: operational && validated === true,
    outputs: { '2stem': true, '4stem': false },
    async separate(input, options = {}) {
      if (!operational) throw new Error('Kaggle Demucs provider is not operational: ticket/completion adapters are missing.');
      const ticket = await issueTicket(input, { ...options, jobType: 'stems', model: 'htdemucs' });
      validateKaggleStemTicket(ticket);
      const completion = await awaitCompletion(ticket.job_id, { ticket, signal: options.signal });
      const proof = normalizeKaggleStemCompletion(completion.proof || completion);
      const vocals = completion.vocals || completion.vocal || null;
      const instrumental = completion.instrumental || null;
      if (!vocals || !instrumental) throw new Error('Kaggle completion did not expose retained stem references.');
      return {
        vocals,
        instrumental,
        recipe: {
          provider: proof.provider,
          family: proof.family,
          model: proof.model,
          modelVersion: proof.version,
          worker: 'PabloVoice_Kaggle_Pipeline_V2',
          operation: 'demucs --two-stems=vocals -n htdemucs',
        },
        proof,
      };
    },
  };
}

function validateOutput(output, name) {
  if (!output || typeof output !== 'object') throw new Error(`${name} is required.`);
  requireText(output.bucket, `${name}.bucket`);
  requireText(output.path, `${name}.path`);
  requireText(output.token, `${name}.token`);
}

function requireSha(value, name) {
  if (!SHA256_RE.test(String(value || ''))) throw new Error(`${name} must be a SHA-256 hex digest.`);
}

function requireHttps(value, name) {
  requireText(value, name);
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer.`);
  return number;
}

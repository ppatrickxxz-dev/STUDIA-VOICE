const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';

function requireApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('ELEVENLABS_API_KEY is required for ElevenMusic API execution');
  }
  return apiKey;
}

async function parseError(response) {
  let detail = '';
  try {
    detail = JSON.stringify(await response.json());
  } catch {
    try { detail = await response.text(); } catch { detail = ''; }
  }
  return `ElevenMusic request failed (${response.status}): ${detail.slice(0, 800)}`;
}

export class ElevenMusicClient {
  constructor({ apiKey = process.env.ELEVENLABS_API_KEY, fetchImpl = globalThis.fetch, baseUrl = DEFAULT_BASE_URL } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
  }

  headers(extra = {}) {
    return { 'xi-api-key': requireApiKey(this.apiKey), ...extra };
  }

  async compose({ prompt = null, compositionPlan = null, musicLengthMs = null, finetuneId = null, storeForInpainting = true, outputFormat = 'mp3_48000_192' } = {}) {
    if (Boolean(prompt) === Boolean(compositionPlan)) {
      throw new Error('Exactly one of prompt or compositionPlan must be supplied');
    }
    const body = {
      model_id: 'music_v2',
      store_for_inpainting: Boolean(storeForInpainting),
    };
    if (prompt) body.prompt = prompt;
    if (compositionPlan) body.composition_plan = compositionPlan;
    if (musicLengthMs != null) body.music_length_ms = musicLengthMs;
    if (finetuneId) body.finetune_id = finetuneId;

    const response = await this.fetch(`${this.baseUrl}/v1/music?output_format=${encodeURIComponent(outputFormat)}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await parseError(response));
    return {
      audio: new Uint8Array(await response.arrayBuffer()),
      songId: response.headers.get('song-id'),
      outputFormat,
      modelId: 'music_v2',
    };
  }

  async uploadForInpainting({ bytes, filename = 'reference.flac', mimeType = 'audio/flac', withTimestamps = false } = {}) {
    if (!bytes) throw new Error('bytes are required');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType }), filename);
    form.append('extract_composition_plan', 'music_v2');
    form.append('with_timestamps', String(Boolean(withTimestamps)));

    const response = await this.fetch(`${this.baseUrl}/v1/music/upload`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!response.ok) throw new Error(await parseError(response));
    return response.json();
  }

  async separateStems({ bytes, filename = 'mix.flac', mimeType = 'audio/flac', variation = 'six_stems_v1', outputFormat = 'pcm_44100' } = {}) {
    if (!['two_stems_v1', 'six_stems_v1'].includes(variation)) throw new Error(`Unsupported stem variation: ${variation}`);
    if (!bytes) throw new Error('bytes are required');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType }), filename);
    form.append('stem_variation_id', variation);

    const response = await this.fetch(`${this.baseUrl}/v1/music/stem-separation?output_format=${encodeURIComponent(outputFormat)}`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!response.ok) throw new Error(await parseError(response));
    return new Uint8Array(await response.arrayBuffer());
  }

  async createFinetune({ files, name, primaryGenre, tags = [], visibility = 'private' } = {}) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('At least one finetune file is required');
    if (!name || !primaryGenre) throw new Error('name and primaryGenre are required');
    const form = new FormData();
    for (const file of files) {
      form.append('files[]', new Blob([file.bytes], { type: file.mimeType || 'audio/wav' }), file.filename || 'training.wav');
    }
    form.append('model_id', 'music_v2');
    form.append('name', name);
    form.append('primary_genre', primaryGenre);
    form.append('tags', JSON.stringify(tags));
    form.append('visibility', visibility);

    const response = await this.fetch(`${this.baseUrl}/v1/music/finetunes`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!response.ok) throw new Error(await parseError(response));
    return response.json();
  }
}

export function buildInpaintingPlan({ songId, durationMs, replacements }) {
  if (!songId) throw new Error('songId is required');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('durationMs must be positive');
  if (!Array.isArray(replacements) || replacements.length === 0) throw new Error('At least one replacement is required');

  const sorted = [...replacements].sort((a, b) => a.startMs - b.startMs);
  const chunks = [];
  let cursor = 0;

  for (const replacement of sorted) {
    const { startMs, endMs, text, positiveStyles = [], negativeStyles = [], contextAdherence = 'high' } = replacement;
    if (![startMs, endMs].every(Number.isFinite) || startMs < cursor || endMs <= startMs || endMs > durationMs) {
      throw new Error('Replacement ranges must be ordered, non-overlapping and inside the source duration');
    }
    if (startMs > cursor) chunks.push({ song_id: songId, range: { start_ms: cursor, end_ms: startMs } });
    chunks.push({
      text,
      duration_ms: endMs - startMs,
      positive_styles: positiveStyles,
      negative_styles: negativeStyles,
      context_adherence: contextAdherence,
    });
    cursor = endMs;
  }
  if (cursor < durationMs) chunks.push({ song_id: songId, range: { start_ms: cursor, end_ms: durationMs } });
  return { chunks };
}

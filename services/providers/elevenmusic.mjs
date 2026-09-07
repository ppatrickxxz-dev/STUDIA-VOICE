const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const SYNTH_GUIDE_PLACEHOLDERS = new Set(['guia', 'melodica', 'para', 'cantar']);

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

export function buildPabloMusicV2Plan({ plan, negativeStyles = [] } = {}) {
  if (!plan || !Array.isArray(plan.sections) || plan.sections.length === 0) {
    throw new Error('A PabloVoice song plan with sections is required');
  }

  const guideLines = Array.isArray(plan.guideLines) ? plan.guideLines : [];
  const instrumentalOnly = isInstrumentalPlan(plan, guideLines);
  const promptDirections = productionBriefStyles(plan.brief);
  const globalStyles = compactStyles([
    ...promptDirections,
    genreStyle(plan.genre),
    plan.mood,
    instrumentalOnly
      ? 'instrumental-only production; musical identity is carried by rhythm, bass, harmony, texture and motifs'
      : 'instrumental drives the groove and arrangement while leaving controlled midrange space for the lead vocal',
    Number.isFinite(Number(plan.bpm)) ? `${Math.round(Number(plan.bpm))} BPM` : '',
    plan.key ? `${plan.key} ${plan.mode === 'major' ? 'major' : 'minor'}` : '',
  ]);
  const negatives = compactStyles([
    ...negativeStyles,
    ...(instrumentalOnly ? ['lead vocals', 'sung lyrics', 'spoken word', 'vocal chops'] : []),
  ]);

  const chunks = plan.sections.map((section) => {
    const startBeat = Number(section.startBeat);
    const endBeat = Number(section.endBeat);
    const startSeconds = Number(section.startSeconds);
    const endSeconds = Number(section.endSeconds);
    if (![startBeat, endBeat, startSeconds, endSeconds].every(Number.isFinite) || endBeat <= startBeat || endSeconds <= startSeconds) {
      throw new Error(`Invalid PabloVoice section timing: ${String(section.id || section.label || 'unknown')}`);
    }

    const lines = instrumentalOnly ? [] : guideLines
      .filter((line) => Number(line.startBeat) >= startBeat && Number(line.startBeat) < endBeat)
      .map((line) => String(line.text || '').trim())
      .filter(Boolean);
    const label = String(section.label || section.id || 'Section').trim().slice(0, 80) || 'Section';
    const energy = Number(section.energy);
    const localStyles = compactStyles([
      sectionRoleStyle(section.id || section.label, instrumentalOnly),
      Number.isFinite(energy) ? energyStyle(energy) : '',
      ...globalStyles,
    ]);

    return {
      text: lines.length ? `[${label}]\n${lines.join('\n')}` : `[${label} instrumental]`,
      duration_ms: Math.max(1000, Math.round((endSeconds - startSeconds) * 1000)),
      positive_styles: localStyles,
      negative_styles: negatives,
      context_adherence: 'high',
    };
  });

  return { chunks };
}

export function productionBriefStyles(value = '') {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];

  // Music generators respond more consistently when a long description is
  // compiled into short production directions instead of one prose paragraph.
  // Keep the user's own wording and ordering; only segment and deduplicate it.
  const clauses = source
    .split(/[,;|]+|\.(?=\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.slice(0, 150));

  const selected = [];
  const categories = [
    /groove|rhythm|ritmo|batida|drum|bateria|percuss|kick|snare|caixa|swing|syncop|sincop|clave|dembow/i,
    /bass|baixo|sub|grave/i,
    /synth|sintet|pad|pluck|keys|piano|guitar|viol[aã]o|string|cordas|brass|metais/i,
    /chorus|refr[aã]o|hook|verse|verso|bridge|ponte|intro|outro|post|motif|motivo|arranj|build|cresce|abre/i,
  ];

  if (clauses[0]) selected.push(clauses[0]);
  for (const category of categories) {
    const match = clauses.find((clause) => category.test(clause));
    if (match) selected.push(match);
  }
  for (const clause of clauses) {
    if (selected.length >= 6) break;
    selected.push(clause);
  }
  return compactStyles(selected).slice(0, 6);
}

export function isInstrumentalPlan(plan = {}, guideLines = []) {
  const explicitMode = String(plan.creationMode || plan.creation_mode || plan.vocalIntent || '').toLowerCase();
  if (['instrumental', 'instrumental_first', 'instrumental-only', 'instrumental_only'].includes(explicitMode)) return true;
  if (!Array.isArray(guideLines) || guideLines.length === 0) return true;

  // The local guide renderer intentionally creates these four placeholder words
  // when no lyrics exist. They are a local audition aid and must never be sent to
  // the connected music provider as lyric content.
  const words = guideLines
    .map((line) => normalizeWord(line?.text))
    .filter(Boolean);
  return words.length > 0 && words.every((word) => SYNTH_GUIDE_PLACEHOLDERS.has(word));
}

function sectionRoleStyle(value = '', instrumentalOnly = false) {
  const id = normalizeWord(value).replace(/\s+/g, '_');
  if (/intro/.test(id)) return 'intro establishes the sonic palette without revealing the full arrangement';
  if (/pre/.test(id)) return 'pre-chorus builds tension and forward motion toward the hook';
  if (/refr|chorus|hook/.test(id)) return 'chorus opens wider with a memorable motif and fuller rhythm section';
  if (/ponte|bridge/.test(id)) return 'bridge creates a clear textural contrast while preserving the song identity';
  if (/outro/.test(id)) return 'outro resolves the track with a deliberate reduction or final motif';
  if (/vers|verse/.test(id)) {
    return instrumentalOnly
      ? 'verse section develops the groove with controlled density and room for later melodic ideas'
      : 'verse keeps controlled density and leaves space around the lead vocal';
  }
  return 'section evolves the arrangement without overcrowding the core groove';
}

function compactStyles(values) {
  const seen = new Set();
  const output = [];
  for (const value of values.flat ? values.flat() : values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= 12) break;
  }
  return output;
}

function genreStyle(value = '') {
  const genre = String(value || '').toLowerCase();
  if (genre === 'rnb') return 'contemporary R&B';
  if (genre === 'funk') return 'Brazilian funk groove';
  if (genre === 'mpb') return 'Brazilian MPB';
  if (genre === 'rap') return 'hip-hop / rap';
  if (genre === 'dance') return 'dance-pop electronic';
  return genre || 'pop';
}

function energyStyle(value) {
  if (value >= 0.85) return 'high energy, full arrangement';
  if (value >= 0.62) return 'rising energy, fuller arrangement';
  if (value <= 0.35) return 'sparse, restrained arrangement';
  return 'moderate energy, controlled arrangement';
}

function normalizeWord(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .trim();
}

import { startCompositionSession } from './session-engine.mjs';
import { createAuthorialMemory } from './authorial-memory.mjs';

export const REVIEWED_SONG_COMMANDS = Object.freeze(['generate', 'continue_section', 'rewrite', 'adapt_genre']);
const SONG_COMMANDS = new Set(REVIEWED_SONG_COMMANDS);
const TRANSIENT_PROVIDER_ERRORS = new Set(['provider_timeout', 'provider_rate_limited', 'provider_unavailable', 'provider_connection_failed', 'remote_unavailable']);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;

const SECTION_HINTS = Object.freeze([
  ['refrão', /\b(refr[aã]o|hook)\b/i],
  ['pre_refrão', /\b(pr[eé][ -]?refr[aã]o|pre[ -]?chorus)\b/i],
  ['verso', /\b(verso|estrofe)\b/i],
  ['ponte', /\b(ponte|bridge)\b/i],
  ['pos_refrão', /\b(p[oó]s[ -]?refr[aã]o|post[ -]?chorus)\b/i],
  ['rap', /\b(rap|barra|barras)\b/i],
]);

const SONG_CONTENT = /\b(refr[aã]o|hook|verso|estrofe|ponte|letra|texto|trecho|rap|parte)\b/i;
const REWRITE = /\b(reescreve|reescreva|reescrever|refaz|refaça|reformula|reformule|melhora esse|melhore esse)\b/i;
const CONTINUE = /\b(continua|continue|continuar|completa|complete|completar|termina|termine|terminar|pr[oó]ximo verso|pr[oó]xima parte)\b/i;
const ADAPT = /\b(adapta|adapte|adaptar|leva (?:isso|essa|esse)|transforma (?:isso|essa|esse)).{0,40}\b(funk|r&b|rnb|rap|hip.?hop|pop|mpb|pagode|edm|k-?pop|trap)\b/i;
const DIRECT_GENERATE = /\b(escreve|escreva|gera|gere|cria|crie|faz|faça)\b.{0,40}\b(refr[aã]o|hook|verso|estrofe|ponte|letra|rap|parte)\b/i;
const POLITE_GENERATE = /\b(pode|consegue|vamos)\s+(?:me\s+)?(gerar|escrever|fazer|criar)\b.{0,40}\b(refr[aã]o|hook|verso|estrofe|ponte|letra|rap|parte)\b/i;

export class PmiGeneratorAdapter {
  constructor({ invoke, timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = DEFAULT_MAX_RETRIES, sleep = defaultSleep } = {}) {
    if (typeof invoke !== 'function') throw new TypeError('Generator Adapter requer um transport invoke.');
    this.invoke = invoke;
    this.timeoutMs = clampInteger(timeoutMs, 1_000, 60_000, DEFAULT_TIMEOUT_MS);
    this.maxRetries = clampInteger(maxRetries, 0, 1, DEFAULT_MAX_RETRIES);
    this.sleep = typeof sleep === 'function' ? sleep : defaultSleep;
  }

  async execute(request = {}, { signal } = {}) {
    const normalized = normalizeTransportRequest(request);
    const requestId = createRequestId();
    const startedAt = Date.now();
    const controller = new AbortController();
    const stopExternal = forwardAbort(signal, controller);
    const timeout = setTimeout(() => controller.abort(new Error('generator_timeout')), this.timeoutMs);
    const abortError = () => signal?.aborted ? 'request_cancelled' : 'provider_timeout';
    let attempt = 0;
    try {
      while (attempt <= this.maxRetries) {
        attempt += 1;
        let result;
        try {
          result = await this.invoke(normalized, { signal: controller.signal, requestId, attempt });
        } catch {
          if (controller.signal.aborted) return failedResult(abortError(), requestId, startedAt, attempt);
          if (attempt <= this.maxRetries) continue;
          return failedResult('provider_connection_failed', requestId, startedAt, attempt);
        }

        if (controller.signal.aborted) return failedResult(abortError(), requestId, startedAt, attempt);
        const validated = validateTransportResponse(result);
        if (validated.ok) {
          return Object.freeze({
            ok: true,
            text: validated.text,
            reply: validated.text,
            provider: validated.provider,
            model: validated.model,
            request_id: validated.requestId || requestId,
            latency_ms: finiteLatency(result?.latency_ms, Date.now() - startedAt),
            attempts: attempt,
          });
        }

        if (attempt > this.maxRetries || !TRANSIENT_PROVIDER_ERRORS.has(validated.error)) {
          return sanitizedFailure(result, validated.error, validated.requestId || requestId, startedAt, attempt);
        }
        const retryAfterMs = clampInteger(result?.retry_after_ms, 0, 1_500, 250);
        if (retryAfterMs > 0) await abortableSleep(this.sleep, retryAfterMs, controller.signal);
        if (controller.signal.aborted) return failedResult(abortError(), requestId, startedAt, attempt);
      }
      return failedResult('provider_unavailable', requestId, startedAt, attempt);
    } finally {
      clearTimeout(timeout);
      stopExternal();
    }
  }
}

export function planComposerGeneration(message = '', context = {}) {
  const source = String(message || '').trim();
  if (!source) return Object.freeze({ supported: false });
  const command = inferCommand(source);
  if (!command) return Object.freeze({ supported: false });

  const lyrics = String(context.lyrics || '').slice(0, 12000);
  if ((command === 'rewrite' || command === 'continue_section' || command === 'adapt_genre') && !lyrics.trim()) {
    return Object.freeze({
      supported: true,
      blocked: true,
      kind: 'pmi_generation_request',
      reason: 'lyrics_required',
      command,
      targetSection: inferSection(source),
      targetGenre: command === 'adapt_genre' ? inferGenre(source) : null,
    });
  }

  const previousSession = validPreviousSession(context.pmiSession) ? context.pmiSession : null;
  const memory = createAuthorialMemory(context.authorialMemory || previousSession?.authorialMemory || {});
  const creativeBrief = String(previousSession?.concept?.premise || source).trim();
  const previousStructure = Array.isArray(previousSession?.songPlan?.structure) ? previousSession.songPlan.structure : null;
  const session = startCompositionSession({
    brief: creativeBrief,
    lyrics,
    notes: String(context.notes || previousSession?.projectNotes || '').slice(0, 4000),
    preferences: previousStructure ? { structure: previousStructure } : {},
    genre: context.genre || context.preset || '',
    mood: context.mood || '',
    authorialMemory: memory,
  });
  const targetSection = inferSection(source);
  const targetGenre = command === 'adapt_genre' ? inferGenre(source) : null;

  return Object.freeze({
    supported: true,
    blocked: false,
    kind: 'pmi_generation_request',
    command,
    targetSection,
    targetGenre,
    task: source.slice(0, 4000),
    request: Object.freeze({
      command,
      task: source.slice(0, 4000),
      targetSection,
      targetGenre,
      contextPack: Object.freeze({
        source: 'pablovoice-pmi-composer',
        pmi_version: '1.0.0',
        conversational_continuity: Boolean(previousSession),
        target_section: targetSection,
        target_genre: targetGenre,
        concept: session.concept,
        song_plan: session.songPlan,
        project_notes: session.projectNotes,
        current_lyrics: lyrics,
        authorial_memory: memory,
      }),
      authorSamples: lyrics.trim() ? [lyrics.slice(0, 10000)] : [],
      constraints: Object.freeze({
        language: 'pt-BR',
        preserve_authorial_voice: true,
        respect_authorial_memory: true,
        preserve_user_lines: command === 'rewrite',
        minimal_change: command === 'rewrite',
        no_artist_imitation: true,
        review_before_apply: true,
      }),
    }),
    session,
  });
}

export function isExplicitGenerationRequest(message = '') {
  return Boolean(inferCommand(String(message || '')));
}

function normalizeTransportRequest(request = {}) {
  const command = String(request?.command || '');
  if (!SONG_COMMANDS.has(command)) throw new TypeError('Comando de geração não suportado.');
  const projectId = String(request?.project_id || '').trim().slice(0, 160);
  const task = String(request?.task || request?.message || '').trim().slice(0, 12000);
  if (!projectId) throw new TypeError('project_id é obrigatório para o Composer.');
  if (!task) throw new TypeError('task é obrigatória para o Composer.');
  return Object.freeze({
    ...request,
    command,
    project_id: projectId,
    task,
    context_pack: plainObject(request?.context_pack),
    constraints: plainObject(request?.constraints),
    author_samples: Array.isArray(request?.author_samples) ? request.author_samples.slice(0, 3).map((value) => String(value || '').slice(0, 10000)) : [],
    best_of_n: 1,
  });
}

function validateTransportResponse(result) {
  if (!result || typeof result !== 'object') return { ok: false, error: 'provider_invalid_response', requestId: null };
  const requestId = normalizeMeta(result.request_id, 160);
  if (result.ok !== true) return { ok: false, error: normalizeProviderError(result.error), requestId };
  const text = String(result.text || result.reply || '').trim().slice(0, 24000);
  const provider = normalizeMeta(result.provider, 160);
  const model = normalizeMeta(result.model, 160);
  if (!text || !provider || !model) return { ok: false, error: 'provider_invalid_response', requestId };
  return { ok: true, text, provider, model, requestId };
}

function normalizeProviderError(value) {
  const error = String(value || '').trim().slice(0, 120);
  return error || 'provider_invalid_response';
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};
}

function sanitizedFailure(result, error, requestId, startedAt, attempts) {
  const retryAfterMs = clampInteger(result?.retry_after_ms, 0, 1_500, 0);
  return Object.freeze({
    ok: false,
    error,
    request_id: requestId,
    latency_ms: finiteLatency(result?.latency_ms, Date.now() - startedAt),
    attempts,
    ...(retryAfterMs > 0 ? { retry_after_ms: retryAfterMs } : {}),
    ...(result?.fallback_allowed === true ? { fallback_allowed: true } : {}),
  });
}

function failedResult(error, requestId, startedAt, attempts) {
  return Object.freeze({ ok: false, error, request_id: requestId, latency_ms: Math.max(0, Date.now() - startedAt), attempts });
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() || `pmi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function forwardAbort(signal, controller) {
  if (!signal || typeof signal.addEventListener !== 'function') return () => {};
  const abort = () => controller.abort(signal.reason || new Error('generator_cancelled'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener?.('abort', abort);
}

async function abortableSleep(sleep, milliseconds, signal) {
  if (signal.aborted) return;
  await Promise.race([
    sleep(milliseconds),
    new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
  ]);
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function finiteLatency(value, fallback) {
  const latency = Number(value);
  return Number.isFinite(latency) && latency >= 0 ? Math.round(latency) : Math.max(0, Math.round(fallback));
}

function clampInteger(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeMeta(value, limit) {
  const text = String(value || '').trim().slice(0, limit);
  return text || null;
}

function inferCommand(text) {
  if (REWRITE.test(text) && SONG_CONTENT.test(text)) return 'rewrite';
  if (CONTINUE.test(text) && SONG_CONTENT.test(text)) return 'continue_section';
  if (ADAPT.test(text) && SONG_CONTENT.test(text)) return 'adapt_genre';
  if (DIRECT_GENERATE.test(text) || POLITE_GENERATE.test(text)) return 'generate';
  return null;
}

function inferSection(text) {
  for (const [name, pattern] of SECTION_HINTS) if (pattern.test(text)) return name;
  return null;
}

function inferGenre(text) {
  const match = String(text).match(/\b(funk|r&b|rnb|rap|hip.?hop|pop|mpb|pagode|edm|k-?pop|trap)\b/i);
  return match ? match[1].toLowerCase() : null;
}

function validPreviousSession(value) {
  return Boolean(value && value.schema === 'pmi_music_session_v1' && value.concept?.premise && value.songPlan);
}

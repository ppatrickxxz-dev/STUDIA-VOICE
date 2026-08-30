import { healthPayload } from '../services/api/health.mjs';

const SUPABASE_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const PROVIDER = 'cloudflare_workers_ai';
const SONG_COMMANDS = new Set(['generate', 'continue_section', 'rewrite', 'adapt_genre']);
const PROVIDER_TIMEOUT_MS = 20_000;
const CANONICAL_RUNTIME_ORIGIN = 'https://studia-voice.ppatrickxxz.workers.dev';
const ANDROID_APP_ORIGIN = 'https://appassets.androidplatform.net';
const LOCAL_WEB_ORIGINS = ['http://127.0.0.1:4173', 'http://localhost:4173'];
const ALLOWED_CORS_ORIGINS = new Set([CANONICAL_RUNTIME_ORIGIN, ANDROID_APP_ORIGIN, ...LOCAL_WEB_ORIGINS]);

function corsHeaders(request) {
  const origin = String(request.headers.get('origin') || '').trim();
  if (!ALLOWED_CORS_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, apikey',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function bearer(request) {
  const value = String(request.headers.get('authorization') || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function authenticatedUser(jwt) {
  if (!jwt) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${jwt}`,
    },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

async function ownedProject(jwt, projectId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(projectId || ''))) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&select=id,title,bpm,musical_key&limit=1`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${jwt}`,
    },
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

function compact(value, max = 24000) {
  if (value == null) return null;
  try {
    const text = JSON.stringify(value);
    return text.length <= max ? value : { truncated: true, json: text.slice(0, max) };
  } catch {
    return null;
  }
}

function outputText(data) {
  if (typeof data?.response === 'string' && data.response.trim()) return data.response.trim();
  if (typeof data?.result?.response === 'string' && data.result.response.trim()) return data.result.response.trim();
  return '';
}

function requestId() {
  return crypto.randomUUID();
}

function safeLog(fields) {
  console.info(JSON.stringify({ scope: 'pablovoice_cloudflare_composer', ...fields }));
}

function workersAiError(error) {
  const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  if (status === 429 || /rate.?limit|quota|neuron/.test(message)) return { error: 'provider_rate_limited', httpStatus: 429, retryAfterMs: 1000 };
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden/.test(message)) return { error: 'provider_auth_failed', httpStatus: 502, retryAfterMs: 0 };
  return { error: 'provider_unavailable', httpStatus: 502, retryAfterMs: 0 };
}

function providerReadiness(env) {
  const composerReady = Boolean(env.AI && typeof env.AI.run === 'function');
  return {
    ok: true,
    benchmark: 'PabloVoice Benchmark v1',
    providers: {
      elevenmusic: {
        transport: 'official_api',
        configured: Boolean(env.ELEVENLABS_API_KEY),
        runnable: Boolean(env.ELEVENLABS_API_KEY),
      },
      suno: {
        transport: 'interactive_manual',
        configured: true,
        runnable: true,
        automation: false,
      },
      pablovoice: {
        transport: PROVIDER,
        configured: composerReady,
        runnable: composerReady,
      },
    },
    secrets_exposed: false,
  };
}

async function callComposerProvider(request, ai, instructions, input, id) {
  const started = Date.now();
  if (request.signal.aborted) return { ok: false, error: 'request_cancelled', httpStatus: 499, retryAfterMs: 0, latencyMs: 0 };
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('provider_timeout')), PROVIDER_TIMEOUT_MS); });
    const data = await Promise.race([
      ai.run(MODEL, { messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }], max_tokens: 1800 }),
      timeout,
    ]);
    const latencyMs = Date.now() - started;
    const text = outputText(data);
    if (!text) {
      safeLog({ request_id: id, provider: PROVIDER, model: MODEL, status: 'error', latency_ms: latencyMs, error_type: 'remote_empty_response' });
      return { ok: false, error: 'remote_empty_response', httpStatus: 502, retryAfterMs: 0, latencyMs };
    }
    safeLog({ request_id: id, provider: PROVIDER, model: MODEL, status: 200, latency_ms: latencyMs, error_type: null });
    return { ok: true, text, model: MODEL, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const classified = error?.message === 'provider_timeout'
      ? { error: 'provider_timeout', httpStatus: 502, retryAfterMs: 0 }
      : workersAiError(error);
    safeLog({ request_id: id, provider: PROVIDER, model: MODEL, status: 'error', latency_ms: latencyMs, error_type: classified.error });
    return { ok: false, ...classified, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

async function pabloAgent(request, env) {
  const providerReady = Boolean(env.AI && typeof env.AI.run === 'function');
  const cors = corsHeaders(request);

  if (request.method === 'GET') {
    return json({
      ok: true,
      service: 'pablovoice-cloudflare-agent',
      configured: providerReady,
      provider: PROVIDER,
      model: MODEL,
      credential_exposed: false,
      auth_for_turns: 'required',
      songwriting_commands: [...SONG_COMMANDS],
      provider_timeout_ms: PROVIDER_TIMEOUT_MS,
    }, 200, cors);
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, cors);

  const id = requestId();
  const jwt = bearer(request);
  const user = await authenticatedUser(jwt).catch(() => null);
  if (!user) return json({ ok: false, error: 'auth_required', request_id: id }, 401, cors);

  const body = await request.json().catch(() => ({}));
  const command = String(body.command || '');
  const task = String(body.task || body.message || '').trim().slice(0, 12000);
  if (!SONG_COMMANDS.has(command)) return json({ ok: false, error: 'unsupported_command', request_id: id }, 400, cors);
  if (!task) return json({ ok: false, error: 'message_required', request_id: id }, 400, cors);

  const project = await ownedProject(jwt, String(body.project_id || '')).catch(() => null);
  if (!project) return json({ ok: false, error: 'project_not_found', request_id: id }, 404, cors);
  if (!providerReady) return json({ ok: false, error: 'provider_unavailable', request_id: id, fallback_allowed: false }, 503, cors);

  const instructions = [
    'Você é o motor de composição do PabloVoice.',
    'Execute somente o comando solicitado: generate, continue_section, rewrite ou adapt_genre.',
    'Escreva em português brasileiro quando a tarefa estiver em português.',
    'Preserve intenção, perspectiva, oralidade e voz autoral; em rewrite altere o mínimo necessário.',
    'Rima, métrica e prosódia devem servir ao sentido e à musicalidade.',
    'Trate gêneros como linguagens históricas e musicais, sem caricatura cultural.',
    'Não imite literalmente artistas, melodias ou letras existentes.',
    'Não explique raciocínio. Retorne somente material criativo ou direção musical pronta para revisão.',
  ].join(' ');

  const input = JSON.stringify({
    command,
    task,
    project,
    context_pack: compact(body.context_pack, 28000),
    constraints: compact(body.constraints, 6000),
    author_samples: compact(body.author_samples, 10000),
  });

  try {
    const provider = await callComposerProvider(request, env.AI, instructions, input, id);
    if (!provider.ok) {
      return json({
        ok: false,
        error: provider.error,
        request_id: id,
        retry_after_ms: provider.retryAfterMs,
        latency_ms: provider.latencyMs,
        fallback_allowed: false,
      }, provider.httpStatus, cors);
    }
    return json({
      ok: true,
      service: 'pablovoice-cloudflare-agent',
      provider: PROVIDER,
      model: provider.model,
      command,
      project_id: project.id,
      reply: provider.text,
      text: provider.text,
      request_id: id,
      latency_ms: provider.latencyMs,
      fallback_allowed: false,
    }, 200, cors);
  } catch {
    safeLog({ request_id: id, provider: PROVIDER, model: MODEL, status: 'error', latency_ms: null, error_type: 'agent_backend_error' });
    return json({ ok: false, error: 'agent_backend_error', request_id: id, fallback_allowed: false }, 503, cors);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405, cors);
      return json(healthPayload(String(env.PV_COMMIT || 'cloudflare')), 200, cors);
    }

    if (url.pathname === '/api/provider-readiness') {
      if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405, cors);
      return json(providerReadiness(env), 200, cors);
    }

    if (url.pathname === '/api/pablo-agent') {
      return pabloAgent(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'not_found' }, 404, cors);
    }

    return env.ASSETS.fetch(request);
  },
};

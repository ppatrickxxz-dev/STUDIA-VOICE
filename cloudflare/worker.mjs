import { healthPayload } from '../services/api/health.mjs';

const SUPABASE_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5.4-mini';
const SONG_COMMANDS = new Set(['generate', 'continue_section', 'rewrite', 'adapt_genre']);
const PROVIDER_TIMEOUT_MS = 20_000;

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
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === 'string' && part.text.trim()) parts.push(part.text.trim());
    }
  }
  return parts.join('\n').trim();
}

function requestId() {
  return crypto.randomUUID();
}

function safeLog(fields) {
  console.info(JSON.stringify({ scope: 'pablovoice_cloudflare_composer', ...fields }));
}

function boundedRetryAfter(value) {
  if (!value) return 250;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(1500, Math.round(seconds * 1000)));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(1500, date - Date.now())) : 250;
}

function providerError(status) {
  if (status === 401 || status === 403) return 'provider_auth_failed';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'remote_provider_failed';
}

function providerHttpStatus(status) {
  if (status === 429) return 429;
  return 502;
}

function providerReadiness(env) {
  const composerReady = Boolean(String(env.OPENAI_API_KEY || '').trim());
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
        transport: 'openai_responses_api',
        configured: composerReady,
        runnable: composerReady,
      },
    },
    secrets_exposed: false,
  };
}

async function callComposerProvider(request, key, instructions, input, id) {
  const started = Date.now();
  const controller = new AbortController();
  const abortFromClient = () => controller.abort('client_cancelled');
  if (request.signal.aborted) abortFromClient();
  else request.signal.addEventListener('abort', abortFromClient, { once: true });
  const timer = setTimeout(() => controller.abort('provider_timeout'), PROVIDER_TIMEOUT_MS);

  try {
    let upstream;
    try {
      upstream = await fetch(OPENAI_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'user-agent': 'PabloVoice-Studio/8.1',
        },
        body: JSON.stringify({
          model: MODEL,
          instructions,
          input,
          max_output_tokens: 1800,
        }),
      });
    } catch {
      const errorType = request.signal.aborted ? 'request_cancelled' : controller.signal.aborted ? 'provider_timeout' : 'provider_connection_failed';
      const latencyMs = Date.now() - started;
      safeLog({ request_id: id, provider: 'openai_responses_api', model: MODEL, status: 'error', latency_ms: latencyMs, error_type: errorType });
      return { ok: false, error: errorType, httpStatus: errorType === 'request_cancelled' ? 499 : 502, retryAfterMs: 0, latencyMs };
    }

    const latencyMs = Date.now() - started;
    const raw = await upstream.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      safeLog({ request_id: id, provider: 'openai_responses_api', model: MODEL, status: upstream.status, latency_ms: latencyMs, error_type: 'provider_invalid_response' });
      return { ok: false, error: 'provider_invalid_response', httpStatus: 502, retryAfterMs: 0, latencyMs };
    }

    if (!upstream.ok) {
      const error = providerError(upstream.status);
      const retryAfterMs = error === 'provider_rate_limited' ? boundedRetryAfter(upstream.headers.get('retry-after')) : 0;
      safeLog({ request_id: id, provider: 'openai_responses_api', model: MODEL, status: upstream.status, latency_ms: latencyMs, error_type: error });
      return { ok: false, error, httpStatus: providerHttpStatus(upstream.status), retryAfterMs, latencyMs };
    }

    const text = outputText(data);
    if (!text) {
      safeLog({ request_id: id, provider: 'openai_responses_api', model: String(data?.model || MODEL), status: upstream.status, latency_ms: latencyMs, error_type: 'remote_empty_response' });
      return { ok: false, error: 'remote_empty_response', httpStatus: 502, retryAfterMs: 0, latencyMs };
    }

    const model = String(data?.model || MODEL).slice(0, 160);
    safeLog({ request_id: id, provider: 'openai_responses_api', model, status: upstream.status, latency_ms: latencyMs, error_type: null });
    return { ok: true, text, model, latencyMs };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener?.('abort', abortFromClient);
  }
}

async function pabloAgent(request, env) {
  const providerKey = String(env.OPENAI_API_KEY || '').trim();

  if (request.method === 'GET') {
    return json({
      ok: true,
      service: 'pablovoice-cloudflare-agent',
      configured: Boolean(providerKey),
      provider: 'openai_responses_api',
      model: MODEL,
      credential_exposed: false,
      auth_for_turns: 'required',
      songwriting_commands: [...SONG_COMMANDS],
      provider_timeout_ms: PROVIDER_TIMEOUT_MS,
    });
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const id = requestId();
  const jwt = bearer(request);
  const user = await authenticatedUser(jwt).catch(() => null);
  if (!user) return json({ ok: false, error: 'auth_required', request_id: id }, 401);

  const body = await request.json().catch(() => ({}));
  const command = String(body.command || '');
  const task = String(body.task || body.message || '').trim().slice(0, 12000);
  if (!SONG_COMMANDS.has(command)) return json({ ok: false, error: 'unsupported_command', request_id: id }, 400);
  if (!task) return json({ ok: false, error: 'message_required', request_id: id }, 400);

  const project = await ownedProject(jwt, String(body.project_id || '')).catch(() => null);
  if (!project) return json({ ok: false, error: 'project_not_found', request_id: id }, 404);
  if (!providerKey) return json({ ok: false, error: 'provider_unavailable', request_id: id, fallback_allowed: false }, 503);

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
    const provider = await callComposerProvider(request, providerKey, instructions, input, id);
    if (!provider.ok) {
      return json({
        ok: false,
        error: provider.error,
        request_id: id,
        retry_after_ms: provider.retryAfterMs,
        latency_ms: provider.latencyMs,
        fallback_allowed: false,
      }, provider.httpStatus);
    }
    return json({
      ok: true,
      service: 'pablovoice-cloudflare-agent',
      provider: 'openai_responses_api',
      model: provider.model,
      command,
      project_id: project.id,
      reply: provider.text,
      text: provider.text,
      request_id: id,
      latency_ms: provider.latencyMs,
      fallback_allowed: false,
    });
  } catch {
    safeLog({ request_id: id, provider: 'openai_responses_api', model: MODEL, status: 'error', latency_ms: null, error_type: 'agent_backend_error' });
    return json({ ok: false, error: 'agent_backend_error', request_id: id, fallback_allowed: false }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return json(healthPayload(String(env.PV_COMMIT || 'cloudflare')));
    }

    if (url.pathname === '/api/provider-readiness') {
      if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return json(providerReadiness(env));
    }

    if (url.pathname === '/api/pablo-agent') {
      return pabloAgent(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

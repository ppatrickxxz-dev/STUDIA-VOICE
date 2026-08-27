const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-benchmark-token',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const LEGACY_AGENT = 'https://yokmhqoncdwvxmzzybqa.supabase.co/functions/v1/validate-app-js-v62';
const COMPOSER_AGENT = 'https://studia-voice.vercel.app/api/pablo-agent';
const SONG_COMMANDS = new Set(['generate', 'continue_section', 'rewrite', 'adapt_genre']);

function forwardHeaders(req: Request) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  for (const name of ['authorization', 'apikey', 'x-benchmark-token']) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

async function health(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } });
    const data = await response.json().catch(() => ({}));
    return response.ok && data?.ok ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function proxy(req: Request, url: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: forwardHeaders(req),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, error: 'invalid_upstream_response' }; }
    return json(data, response.status >= 500 ? 200 : response.status);
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error);
    return json({ ok: false, error: detail.includes('Abort') ? 'remote_timeout' : 'agent_router_unavailable', fallback_allowed: true });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  if (req.method === 'GET') {
    const [composer, legacy] = await Promise.all([health(COMPOSER_AGENT), health(LEGACY_AGENT)]);
    const composerReady = Boolean(composer?.configured);
    const legacyReady = Boolean(legacy?.configured);
    return json({
      ok: true,
      service: 'pablovoice-agent-router',
      version: '1.0.0',
      configured: composerReady || legacyReady,
      songwriting_ready: composerReady || legacyReady,
      composer: composerReady ? 'vercel_oidc' : (legacyReady ? legacy?.provider || 'legacy' : 'unavailable'),
      general_reasoning: legacyReady ? legacy?.provider || 'legacy' : 'local_fallback',
      credential_exposed: false,
      auth_for_turns: 'required',
      songwriting_commands: [...SONG_COMMANDS],
    });
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => ({}));
  const command = String((body as Record<string, unknown>)?.command || '');

  if (SONG_COMMANDS.has(command)) {
    const composer = await health(COMPOSER_AGENT);
    if (composer?.configured) return proxy(req, COMPOSER_AGENT, body);
    return proxy(req, LEGACY_AGENT, body);
  }

  return proxy(req, LEGACY_AGENT, body);
});

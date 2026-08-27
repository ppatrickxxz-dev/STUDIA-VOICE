const SUPABASE_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/responses';
const MODEL = 'openai/gpt-5.4-mini';
const SONG_COMMANDS = new Set(['generate', 'continue_section', 'rewrite', 'adapt_genre']);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function bearer(req) {
  const value = String(req.headers?.authorization || '');
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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      service: 'pablovoice-vercel-oidc-agent',
      configured: Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY),
      model: MODEL,
      credential_exposed: false,
      auth_for_turns: 'required',
      songwriting_commands: [...SONG_COMMANDS],
    });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  const jwt = bearer(req);
  const user = await authenticatedUser(jwt).catch(() => null);
  if (!user) return send(res, 401, { ok: false, error: 'auth_required' });

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const command = String(body.command || '');
  const task = String(body.task || body.message || '').trim().slice(0, 12000);
  if (!SONG_COMMANDS.has(command)) return send(res, 400, { ok: false, error: 'unsupported_command' });
  if (!task) return send(res, 400, { ok: false, error: 'message_required' });

  const project = await ownedProject(jwt, String(body.project_id || '')).catch(() => null);
  if (!project) return send(res, 404, { ok: false, error: 'project_not_found' });

  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '';
  if (!gatewayToken) return send(res, 503, { ok: false, error: 'gateway_unavailable', fallback_allowed: true });

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const upstream = await fetch(GATEWAY_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${gatewayToken}`,
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
    const raw = await upstream.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!upstream.ok) {
      console.error('PabloVoice AI Gateway error', upstream.status, String(data?.error?.message || raw).slice(0, 400));
      return send(res, 200, { ok: false, error: 'remote_provider_failed', status: upstream.status, fallback_allowed: true });
    }
    const text = outputText(data);
    if (!text) return send(res, 200, { ok: false, error: 'remote_empty_response', fallback_allowed: true });
    return send(res, 200, {
      ok: true,
      service: 'pablovoice-vercel-oidc-agent',
      provider: 'vercel_ai_gateway_oidc',
      model: String(data?.model || MODEL),
      command,
      project_id: project.id,
      reply: text,
      text,
    });
  } catch (error) {
    const message = String(error?.message || error);
    return send(res, 200, { ok: false, error: message.includes('Abort') ? 'remote_timeout' : 'agent_backend_error', fallback_allowed: true });
  } finally {
    clearTimeout(timer);
  }
}

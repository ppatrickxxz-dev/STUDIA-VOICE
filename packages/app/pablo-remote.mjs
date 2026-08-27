import { listProjects } from './storage.mjs';
import { RemoteAuthAdapter } from './remote-auth.mjs';

const auth = new RemoteAuthAdapter();
const remoteState = {
  health: null,
  messages: [],
  busy: false,
  initialized: false,
  activeLocalProjectId: '',
};

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

async function currentLocalProject() {
  const projects = await listProjects();
  if (!projects.length) return null;
  if (remoteState.activeLocalProjectId) {
    const active = projects.find((project) => project.id === remoteState.activeLocalProjectId);
    if (active) return active;
  }
  return [...projects].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
}

function contextPack(project) {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  return {
    source: 'pablovoice-local-first',
    project: {
      local_id: project?.id || null,
      title: project?.name || 'Projeto PabloVoice',
      tracks: tracks.length,
      preset: project?.preset || null,
      has_lyrics: Boolean(String(project?.lyrics || '').trim()),
      active_track_id: project?.activeTrackId || null,
    },
    tracks: tracks.slice(0, 12).map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      duration: Number(track.duration || 0),
      gain: Number(track.gain ?? 1),
      pan: Number(track.pan || 0),
      muted: Boolean(track.muted),
      solo: Boolean(track.solo),
      effects: track.effects || {},
    })),
  };
}

function statusLabel() {
  if (remoteState.busy) return 'consultando Pablo…';
  if (remoteState.health?.available && remoteState.health?.authenticated) return 'Pablo remoto disponível';
  if (remoteState.health?.available) return 'Pablo remoto requer sessão';
  return 'Pablo local ativo';
}

function remoteMarkup() {
  const enabled = Boolean(remoteState.health?.available && remoteState.health?.authenticated);
  const messages = remoteState.messages.map((message) => `<div class="pv-msg ${message.role === 'user' ? 'user' : 'assistant'}">${esc(message.text)}<small>${message.role === 'user' ? 'você' : 'Pablo remoto'}</small></div>`).join('');
  return `<article class="pv-card chrome" data-pablo-remote>
    <div class="pv-card-head"><div><h3>Conversar com Pablo</h3><p>${esc(statusLabel())}. O Studio local continua funcionando mesmo sem rede.</p></div><span class="pv-tag ${enabled ? 'ok' : ''}">${enabled ? 'REMOTO' : 'LOCAL'}</span></div>
    <div class="pv-tips" data-pablo-remote-messages>${messages || '<div class="pv-note">A conversa remota só é ativada quando sessão e provider estão saudáveis.</div>'}</div>
    <form data-pablo-remote-form class="pv-compose-row">
      <input name="message" maxlength="1200" autocomplete="off" placeholder="Ex.: O que você melhoraria nessa voz?" ${enabled && !remoteState.busy ? '' : 'disabled'}>
      <button class="pv-btn primary" ${enabled && !remoteState.busy ? '' : 'disabled'}>${remoteState.busy ? 'Enviando…' : 'Enviar'}</button>
    </form>
  </article>`;
}

function mount() {
  const pabloTitle = [...document.querySelectorAll('.pv-kicker')].find((node) => node.textContent?.includes('Pablo'));
  if (!pabloTitle) return;
  if (document.querySelector('[data-pablo-remote]')) return;
  const shell = document.querySelector('.pv-chat-shell');
  if (!shell) return;
  shell.insertAdjacentHTML('afterend', remoteMarkup());
}

async function refreshHealth() {
  remoteState.health = await auth.agentHealth();
  const existing = document.querySelector('[data-pablo-remote]');
  if (existing) existing.outerHTML = remoteMarkup();
  else mount();
}

async function send(message) {
  const project = await currentLocalProject();
  if (!project) return { ok: false, error: 'Crie um projeto antes de conversar com Pablo.' };
  const linked = await auth.ensureRemoteProject(project);
  if (!linked?.ok || !linked.project?.id) return { ok: false, error: 'Pablo remoto não conseguiu vincular este projeto agora.' };
  const result = await auth.agentTurn({
    project_id: linked.project.id,
    message,
    intent: { mode: 'advice_only', destructive_actions: false },
    context_pack: contextPack(project),
    tools: [],
  });
  if (!result?.ok || !result.reply) return { ok: false, error: 'Pablo remoto está indisponível agora; as sugestões locais continuam ativas.' };
  return { ok: true, reply: String(result.reply) };
}

document.addEventListener('click', (event) => {
  const opener = event.target.closest('[data-action="open-project"][data-id]');
  if (opener?.dataset.id) remoteState.activeLocalProjectId = opener.dataset.id;
}, true);

document.addEventListener('submit', async (event) => {
  if (!event.target.matches('[data-pablo-remote-form]')) return;
  event.preventDefault();
  if (remoteState.busy) return;
  const input = event.target.elements.message;
  const message = String(input?.value || '').trim();
  if (!message) return;
  remoteState.messages.push({ role: 'user', text: message });
  remoteState.busy = true;
  mount();
  const existing = document.querySelector('[data-pablo-remote]');
  if (existing) existing.outerHTML = remoteMarkup();
  const result = await send(message).catch(() => ({ ok: false, error: 'Pablo remoto está indisponível agora.' }));
  remoteState.messages.push({ role: 'assistant', text: result.ok ? result.reply : result.error });
  remoteState.busy = false;
  const current = document.querySelector('[data-pablo-remote]');
  if (current) current.outerHTML = remoteMarkup();
});

const observer = new MutationObserver(() => mount());
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

auth.consumeBootstrapFragment();
refreshHealth().catch(() => {});
mount();

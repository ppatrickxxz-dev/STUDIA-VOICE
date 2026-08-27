import { RemoteAuthAdapter } from './remote-auth.mjs';
import { VoiceIdentityReferenceClient } from './providers/src/voice-identity-reference-client.mjs';

const PROJECT_URL = 'https://yokmhqoncdwvxmzzybqa.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_bERmgxiwqEbVFUQ2W5-ggA_1Z6-vALH';
const auth = new RemoteAuthAdapter();
const client = new VoiceIdentityReferenceClient({ supabaseUrl: PROJECT_URL, publishableKey: PUBLISHABLE_KEY });

let observer;
let loading = false;
let snapshot = { voiceModel: null, reference: null, candidates: [] };

export function installVoiceIdentityReferenceUI() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => injectPanel());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectPanel();
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('click', handleClick);
    document.removeEventListener('change', handleChange);
  };
}

function injectPanel() {
  const parent = document.querySelector('#pv-ai-voice-harmony');
  if (!parent || parent.querySelector('#pv-identity-reference')) return;
  const voiceList = parent.querySelector('#pv-ai-voice-list');
  const panel = document.createElement('section');
  panel.id = 'pv-identity-reference';
  panel.className = 'pv-panel-grid';
  panel.innerHTML = `
    <div class="pv-card-head">
      <div><h3>Minha voz de referência</h3><p>Escolha uma gravação original sua para o Pablo comprovar identidade vocal. Nada é escolhido automaticamente.</p></div>
      <span class="pv-tag">IDENTIDADE</span>
    </div>
    <div class="pv-note" id="pv-identity-reference-status">Toque em “Carregar gravações” para escolher uma referência.</div>
    <div class="pv-compose-row">
      <select class="pv-field" id="pv-identity-reference-select" aria-label="Gravação de referência" disabled>
        <option value="">Escolha uma gravação original…</option>
      </select>
      <button class="pv-btn" type="button" data-identity-reference-load>Carregar gravações</button>
      <button class="pv-btn primary" type="button" data-identity-reference-set disabled>Usar como minha referência</button>
      <button class="pv-btn" type="button" data-identity-reference-clear disabled>Remover referência</button>
    </div>`;
  if (voiceList) voiceList.insertAdjacentElement('beforebegin', panel);
  else parent.append(panel);
}

async function handleClick(event) {
  const load = event.target.closest('[data-identity-reference-load]');
  if (load) return refresh(load);
  const set = event.target.closest('[data-identity-reference-set]');
  if (set) return setReference(set);
  const clear = event.target.closest('[data-identity-reference-clear]');
  if (clear) return clearReference(clear);
}

function handleChange(event) {
  if (event.target.id !== 'pv-identity-reference-select') return;
  const button = document.querySelector('[data-identity-reference-set]');
  if (button) button.disabled = !event.target.value || loading;
}

async function sessionToken() {
  const session = await auth.ensureSession();
  if (!session?.accessToken) throw new Error('Entre no PabloVoice para escolher sua referência de identidade.');
  return session.accessToken;
}

async function refresh(button = null) {
  if (loading) return;
  loading = true;
  setBusy(button, true, 'Carregando…');
  setStatus('Lendo apenas suas gravações originais verificadas…');
  try {
    snapshot = await client.list({ accessToken: await sessionToken() });
    renderSnapshot();
    notifyIdentityChange('refreshed');
  } catch (error) {
    setStatus(error?.message || 'Não consegui carregar suas gravações de referência.');
  } finally {
    loading = false;
    setBusy(button, false, 'Carregar gravações');
    syncButtons();
  }
}

async function setReference(button) {
  if (loading) return;
  const select = document.querySelector('#pv-identity-reference-select');
  const assetId = String(select?.value || '');
  if (!assetId || !snapshot.voiceModel?.id) return;
  const candidate = snapshot.candidates.find((item) => item.id === assetId);
  loading = true;
  setBusy(button, true, 'Salvando…');
  try {
    await client.set({
      accessToken: await sessionToken(),
      voiceModelId: snapshot.voiceModel.id,
      assetId,
      label: candidate?.name || null,
    });
    snapshot = await client.list({ accessToken: await sessionToken() });
    renderSnapshot();
    notifyIdentityChange('set');
    setStatus(`Referência definida: ${snapshot.reference?.label || candidate?.name || 'gravação original'}. Ela será a base para comprovar sua identidade vocal.`);
  } catch (error) {
    setStatus(error?.message || 'Não consegui salvar essa referência.');
  } finally {
    loading = false;
    setBusy(button, false, 'Usar como minha referência');
    syncButtons();
  }
}

async function clearReference(button) {
  if (loading || !snapshot.voiceModel?.id) return;
  loading = true;
  setBusy(button, true, 'Removendo…');
  try {
    await client.clear({ accessToken: await sessionToken(), voiceModelId: snapshot.voiceModel.id });
    snapshot = await client.list({ accessToken: await sessionToken() });
    renderSnapshot();
    notifyIdentityChange('cleared');
    setStatus('Referência removida. O Pablo não vai declarar identidade validada até você escolher outra gravação original.');
  } catch (error) {
    setStatus(error?.message || 'Não consegui remover a referência.');
  } finally {
    loading = false;
    setBusy(button, false, 'Remover referência');
    syncButtons();
  }
}

function notifyIdentityChange(reason) {
  document.dispatchEvent(new CustomEvent('pablovoice:identity-reference-changed', {
    detail: { reason: String(reason || 'changed'), configured: Boolean(snapshot.reference?.id) },
  }));
}

function renderSnapshot() {
  const select = document.querySelector('#pv-identity-reference-select');
  if (!select) return;
  const currentAssetId = snapshot.reference?.asset_id || '';
  select.replaceChildren(option('', 'Escolha uma gravação original…'));
  for (const candidate of snapshot.candidates) {
    const duration = candidate.durationSeconds ? ` · ${candidate.durationSeconds.toFixed(1)} s` : '';
    const source = candidate.kind === 'take' ? 'gravação' : 'arquivo original';
    select.append(option(candidate.id, `${candidate.name} · ${source}${duration}`));
  }
  select.disabled = snapshot.candidates.length === 0 || !snapshot.voiceModel;
  select.value = snapshot.candidates.some((item) => item.id === currentAssetId) ? currentAssetId : '';

  if (!snapshot.voiceModel) setStatus('Seu modelo de voz ainda não está pronto.');
  else if (snapshot.reference) setStatus(`Referência ativa: ${snapshot.reference.label || 'gravação original'}. O arquivo fica privado; só a prova acústica poderá ser usada pelo gate de identidade.`);
  else if (!snapshot.candidates.length) setStatus('Ainda não encontrei uma gravação original verificada. Grave uma voz ou importe um arquivo-fonte antes de definir identidade.');
  else setStatus('Escolha conscientemente a gravação que melhor representa sua voz natural.');
  syncButtons();
}

function syncButtons() {
  const select = document.querySelector('#pv-identity-reference-select');
  const set = document.querySelector('[data-identity-reference-set]');
  const clear = document.querySelector('[data-identity-reference-clear]');
  if (set) set.disabled = loading || !select?.value || !snapshot.voiceModel?.id;
  if (clear) clear.disabled = loading || !snapshot.reference || !snapshot.voiceModel?.id;
}

function option(value, text) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}

function setStatus(text) {
  const node = document.querySelector('#pv-identity-reference-status');
  if (node) node.textContent = String(text || '');
}

function setBusy(button, busy, text) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = text;
}

const ONLINE_STATUS_REWRITES = Object.freeze([
  [/Conectando ao motor HQ para criar uma base sem letra…/g, 'Preparando a produção conectada para criar o instrumental…'],
  [/Conectando ao motor musical de alta qualidade…/g, 'Preparando a produção conectada…'],
  [/Criando guia melódica separada e salvando a nova versão…/g, 'Criando a guia separada e salvando o novo take…'],
  [/Pronto\. Demo HQ e guia foram salvas como Take/g, 'Pronto. Versão conectada e guia foram salvas como Take'],
  [/Conecte sua sessão do PabloVoice para usar a geração de alta qualidade\. O rascunho local continua disponível\./g, 'Reconheça este aparelho para usar a produção conectada. Seu projeto continua preservado.'],
  [/O motor de alta qualidade não está configurado ou está indisponível agora\. Use o rascunho local sem perder o projeto\./g, 'A produção conectada está indisponível agora. Tente novamente; nenhum take existente foi alterado.'],
  [/O motor de alta qualidade atingiu o limite temporário\. Seu projeto foi preservado\./g, 'A produção conectada atingiu um limite temporário. Seu projeto foi preservado.'],
  [/A geração de alta qualidade não concluiu/g, 'A produção conectada não concluiu'],
]);

let observer = null;
let queued = false;

export function installCreatorOnlineLanguage() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(queueSync);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
  window.addEventListener('online', queueSync);
  window.addEventListener('offline', queueSync);
  queueSync();
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('online', queueSync);
    window.removeEventListener('offline', queueSync);
  };
}

function queueSync() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    syncCreatorLanguage();
  });
}

function syncCreatorLanguage() {
  const form = document.querySelector('[data-song-create-form]');
  if (!form) return;
  ensureCompleteDuration(form);
  syncBusyButtons(form);
  syncStatus();
  syncResult();
}

function ensureCompleteDuration(form) {
  const duration = form.elements.duration;
  if (!(duration instanceof HTMLSelectElement) || duration.querySelector('option[value="200"]')) return;
  const option = document.createElement('option');
  option.value = '200';
  option.textContent = '3:20 · completa';
  duration.appendChild(option);
  for (const item of duration.options) {
    if (item.value === '60' && /rascunho/i.test(item.textContent)) item.textContent = '1:00 · curta';
    if (item.value === '120' && /demo/i.test(item.textContent)) item.textContent = '2:00 · média';
  }
}

function syncBusyButtons(form) {
  const online = navigator.onLine !== false;
  const instrumental = Boolean(form.elements.instrumentalFirst?.checked);
  const connected = form.querySelector('[data-song-create-hq]');
  const local = form.querySelector('[data-song-create-button]');

  if (connected) {
    connected.classList.toggle('busy', connected.disabled);
    if (online && connected.disabled) {
      setText(connected, instrumental ? '● Produzindo instrumental…' : '● Produzindo música…');
    }
  }
  if (local) {
    local.classList.toggle('busy', local.disabled);
    if (!online && local.disabled) setText(local, '♫ Criando offline…');
  }
}

function syncStatus() {
  const status = document.querySelector('#pv-song-create-status');
  if (!status || navigator.onLine === false) return;
  let text = String(status.textContent || '');
  for (const [pattern, replacement] of ONLINE_STATUS_REWRITES) text = text.replace(pattern, replacement);
  setText(status, text);
}

function syncResult() {
  const result = document.querySelector('#pv-song-create-result .pv-song-result');
  if (!result) return;
  const online = navigator.onLine !== false;
  const badge = result.querySelector('.pv-card-head .pv-tag');
  if (badge?.textContent?.includes('HQ')) setText(badge, 'CONECTADO · SALVO');
  else if (!online && badge?.textContent?.includes('LOCAL')) setText(badge, 'OFFLINE · SALVO');

  result.querySelectorAll('.pv-song-audios label').forEach((card) => {
    const strong = card.querySelector('strong');
    const note = card.querySelector('small');
    const label = String(strong?.textContent || '');
    if (/Demo IA HQ · base/i.test(label)) setText(strong, 'Base conectada');
    else if (/Demo IA HQ/i.test(label)) setText(strong, 'Versão conectada');

    if (!note) return;
    let copy = String(note.textContent || '');
    copy = copy
      .replace(/Geração HQ orientada como base instrumental/gi, 'Produção conectada orientada como base instrumental')
      .replace(/Mix de referência de alta qualidade/gi, 'Mix de referência da produção conectada')
      .replace(/Instrumental local editável\./gi, 'Instrumental criado no aparelho e totalmente editável.');
    setText(note, copy);
  });
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node && node.textContent !== text) node.textContent = text;
}

installCreatorOnlineLanguage();

export const CREATOR_CONNECTED_LANGUAGE_POLICY = Object.freeze({
  productLabel: 'Produção conectada',
  providerBrandHiddenFromPrimaryUI: true,
  busyStateNeverLooksIdle: true,
  localLanguageOnlyWhenOffline: true,
});

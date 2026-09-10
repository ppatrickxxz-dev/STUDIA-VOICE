import { analyzeLyrics, rhymeSuggestions } from './songwriting/src/analyzer.mjs';
import { listProjects } from './storage.mjs';
import { RemoteAuthAdapter } from './remote-auth.mjs';

const auth = new RemoteAuthAdapter();
let observer;
let commitPass = false;
let composing = false;
let draftTimer = 0;
let generated = '';
let aiBusy = false;

auth.consumeBootstrapFragment?.();

function decorate() {
  const lyrics = document.querySelector('#lyrics');
  if (lyrics) {
    lyrics.autocapitalize = 'sentences';
    lyrics.autocomplete = 'off';
    lyrics.spellcheck = true;
    lyrics.enterKeyHint = 'enter';
    lyrics.closest('main')?.classList.add('pv-compose-pro');
    const card = lyrics.closest('.pv-card');
    card?.classList.add('pv-lyrics-workspace');
    if (card && !card.querySelector('.pv-lyrics-toolbar')) {
      const tools = document.createElement('div');
      tools.className = 'pv-lyrics-toolbar';
      tools.innerHTML = '<div class="pv-lyrics-toolbar-copy"><b>Escrita livre</b><span data-pv-lyrics-save-state>salva ao sair do campo</span></div><div class="pv-lyrics-section-actions"><button class="pv-compose-chip" type="button" data-pv-section="[Verso]">Verso</button><button class="pv-compose-chip" type="button" data-pv-section="[Pré-refrão]">Pré</button><button class="pv-compose-chip" type="button" data-pv-section="[Refrão]">Refrão</button><button class="pv-compose-chip" type="button" data-pv-section="[Ponte]">Ponte</button></div>';
      lyrics.before(tools);
    }
  }

  const ai = document.querySelector('#pv-ai-composer');
  if (ai) {
    ai.classList.add('pv-ai-composer-pro');
    const title = ai.querySelector('.pv-card-head h3');
    const copy = ai.querySelector('.pv-card-head p');
    if (title) title.textContent = 'Pablo Composer';
    if (copy) copy.textContent = 'Coautor do projeto. O Pablo usa a melhor inteligência disponível sem bloquear sua escrita.';
    const tag = ai.querySelector('.pv-card-head .pv-tag');
    if (tag) tag.textContent = 'PABLO';
    const status = ai.querySelector('#pv-ai-compose-status');
    if (status?.textContent?.includes('Sessão do PabloVoice necessária')) {
      status.textContent = 'Pablo local pronto. A inteligência neural conectada entra automaticamente quando sua sessão estiver disponível.';
    }
    if (!ai.dataset.pro) {
      ai.dataset.pro = '1';
      ai.classList.add('is-collapsed');
      const head = ai.querySelector('.pv-card-head');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pv-compose-disclosure';
      button.textContent = 'Abrir Pablo';
      button.dataset.pvAiToggle = '1';
      button.setAttribute('aria-expanded', 'false');
      head?.append(button);
    }
  }

  const creator = document.querySelector('#pv-song-creator');
  if (creator) {
    creator.classList.add('pv-song-creator-pro');
    const title = creator.querySelector(':scope > .pv-card-head h3');
    const tag = creator.querySelector(':scope > .pv-card-head .pv-tag');
    if (title) title.textContent = 'Criar música';
    if (tag) tag.textContent = 'MÚSICA';
  }
}

function onInputCapture(event) {
  const lyrics = event.target?.closest?.('#lyrics');
  if (!lyrics || commitPass) return;
  if (document.activeElement !== lyrics) return;
  event.stopImmediatePropagation();
  cacheDraft(lyrics.value);
  const status = document.querySelector('[data-pv-lyrics-save-state]');
  if (status) status.textContent = composing ? 'digitando…' : 'rascunho protegido';
}

function onCompositionStart(event) {
  if (event.target?.matches?.('#lyrics')) composing = true;
}

function onCompositionEnd(event) {
  if (!event.target?.matches?.('#lyrics')) return;
  composing = false;
  cacheDraft(event.target.value);
}

function onFocusOut(event) {
  const lyrics = event.target?.closest?.('#lyrics');
  if (!lyrics) return;
  setTimeout(() => {
    if (!lyrics.isConnected || document.activeElement === lyrics) return;
    commitLyrics(lyrics);
  }, 0);
}

function cacheDraft(value) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try { sessionStorage.setItem('pablovoice.lyrics.liveDraft', String(value || '')); } catch { /* storage optional */ }
  }, 120);
}

function commitLyrics(lyrics) {
  if (!lyrics?.isConnected) return;
  try { sessionStorage.setItem('pablovoice.lyrics.liveDraft', String(lyrics.value || '')); } catch { /* storage optional */ }
  commitPass = true;
  lyrics.dispatchEvent(new Event('input', { bubbles: true }));
  commitPass = false;
  const status = document.querySelector('[data-pv-lyrics-save-state]');
  if (status) status.textContent = 'sincronizando…';
}

function onClickCapture(event) {
  const section = event.target.closest?.('[data-pv-section]');
  if (section) {
    const lyrics = document.querySelector('#lyrics');
    if (!lyrics) return;
    event.preventDefault();
    const start = lyrics.selectionStart ?? lyrics.value.length;
    const end = lyrics.selectionEnd ?? start;
    const before = lyrics.value.slice(0, start);
    const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const text = `${prefix}${section.dataset.pvSection}\n`;
    lyrics.setRangeText(text, start, end, 'end');
    lyrics.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    lyrics.focus({ preventScroll: true });
    return;
  }

  const toggle = event.target.closest?.('[data-pv-ai-toggle]');
  if (toggle) {
    event.preventDefault();
    const ai = toggle.closest('#pv-ai-composer');
    const open = ai?.classList.toggle('is-collapsed') === false;
    toggle.textContent = open ? 'Fechar' : 'Abrir Pablo';
    toggle.setAttribute('aria-expanded', String(open));
    return;
  }

  const apply = event.target.closest?.('[data-ai-apply]');
  if (apply && generated) {
    event.preventDefault();
    event.stopImmediatePropagation();
    applyGenerated(apply.dataset.aiApply);
  }
}

async function onSubmitCapture(event) {
  const form = event.target?.closest?.('[data-ai-compose-form]');
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (aiBusy) return;
  const command = String(form.elements.command?.value || 'generate');
  const task = String(form.elements.task?.value || '').trim();
  const lyrics = String(document.querySelector('#lyrics')?.value || '');
  const status = document.querySelector('#pv-ai-compose-status');
  const button = form.querySelector('button[type="submit"]');
  if (!task && command !== 'rewrite') return setText(status, 'Diga ao Pablo o que você quer criar ou melhorar.');
  if (command === 'rewrite' && !lyrics.trim()) return setText(status, 'Escreva um trecho antes de pedir reescrita.');

  aiBusy = true;
  setBusy(button, true);
  setText(status, 'Pablo está lendo a composição e o contexto do projeto…');
  try {
    const remote = await tryRemoteComposer({ command, task, lyrics });
    if (remote) {
      generated = remote.text;
      setComposerResult(generated);
      setText(status, `Pronto com inteligência neural${remote.model ? ` · ${remote.model}` : ''}. Revise antes de aplicar.`);
      return;
    }
    generated = buildLocalCoauthor({ command, task, lyrics });
    setComposerResult(generated);
    setText(status, 'Coautor local ativo · sem bloqueio. A IA neural conectada será usada automaticamente quando houver sessão segura.');
  } catch (error) {
    generated = buildLocalCoauthor({ command, task, lyrics });
    setComposerResult(generated);
    setText(status, `A inteligência conectada não respondeu; continuei localmente sem perder seu trabalho. ${String(error?.message || '').slice(0, 120)}`.trim());
  } finally {
    aiBusy = false;
    setBusy(button, false);
  }
}

async function tryRemoteComposer({ command, task, lyrics }) {
  const session = await auth.ensureSession().catch(() => null);
  if (!session?.accessToken) return null;
  const projects = await listProjects();
  const local = projects[0];
  if (!local) return null;
  const linked = await auth.ensureRemoteProject(local).catch(() => null);
  if (!linked?.ok || !linked.project?.id) return null;
  const health = await auth.agentHealth().catch(() => null);
  if (!health?.available) return null;
  const result = await auth.agentTurn({
    command,
    project_id: linked.project.id,
    task: task || 'Reescreva preservando intenção, oralidade, perspectiva e identidade autoral; altere apenas o necessário.',
    context_pack: {
      source: 'pablovoice-adaptive-composer',
      local_project_id: local.id,
      project_title: local.name,
      preset: local.preset,
      lyrics,
      notes: String(local.notes || '').slice(0, 4000),
    },
    author_samples: lyrics.trim() ? [lyrics.slice(0, 10000)] : [],
    constraints: { language: 'pt-BR', preserve_authorial_voice: true, no_artist_imitation: true },
    best_of_n: 1,
  }).catch(() => null);
  const text = String(result?.reply || result?.text || '').trim();
  return result?.ok && text ? { text, model: result.model || health.model || '' } : null;
}

function buildLocalCoauthor({ command, task, lyrics }) {
  const source = String(lyrics || '').trim();
  const analysis = analyzeLyrics(source);
  const words = extractKeywords(`${task} ${source}`).slice(0, 8);
  const topic = words[0] || 'essa história';
  const second = words[1] || 'noite';
  const third = words[2] || 'vontade';
  const target = analysis.targetSyllables || 8;
  if (command === 'rewrite' && source) {
    const notes = analysis.suggestions.slice(0, 3).map((item) => `• ${item}`).join('\n');
    const last = analysis.lines.at(-1)?.lastWord || topic;
    const rhymes = rhymeSuggestions(last).slice(0, 5);
    return `${source}\n\n[Notas do Pablo]\nMétrica-alvo: ~${target} sílabas.\n${notes || '• Preserve o que já soa natural ao cantar.'}${rhymes.length ? `\nFamília de rima para “${last}”: ${rhymes.join(', ')}.` : ''}`;
  }
  if (command === 'continue_section' && source) {
    return `[Continuação sugerida]\nEu deixo ${topic} falar primeiro\n${second} muda o jeito de olhar\nSe ${third} vier sem roteiro\nEu deixo a próxima linha respirar`;
  }
  if (command === 'adapt_genre') {
    return `[Direção de adaptação]\nTema central: ${topic}\nImagem de apoio: ${second}\nTensão emocional: ${third}\nMétrica sugerida: ~${target} sílabas por linha\nUse contraste de verso contido com refrão mais direto e preserve suas frases autorais existentes.`;
  }
  return `[Verso]\n${capitalize(topic)} chega sem pedir licença\n${capitalize(second)} muda o ar quando você vem\nEu guardo ${third} no meio da conversa\nSem prometer o que ninguém tem\n\n[Pré-refrão]\nSe eu chegar mais perto, deixa acontecer\nPouca palavra, muito pra entender\n\n[Refrão]\nHoje eu quero a frase que fica\nAquela que volta sem eu perceber\n${capitalize(topic)} vira música na pista\nE o resto amanhã a gente vê`;
}

function extractKeywords(value) {
  const stop = new Set(['com','para','uma','que','por','dos','das','sem','mais','muito','muita','anos','como','quero','criar','letra','musica','música','rnb','funk','pop']);
  return [...new Set(String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]{4,}/g) || [])].filter((word) => !stop.has(word));
}

function capitalize(value) { const text = String(value || ''); return text ? text[0].toUpperCase() + text.slice(1) : text; }

function setComposerResult(text) {
  setText(document.querySelector('#pv-ai-compose-result'), text);
  document.querySelectorAll('[data-ai-apply]').forEach((button) => { button.disabled = !text; });
}

function applyGenerated(mode) {
  const lyrics = document.querySelector('#lyrics');
  if (!lyrics || !generated) return;
  const current = String(lyrics.value || '').trimEnd();
  lyrics.value = mode === 'append' && current ? `${current}\n\n${generated}` : generated;
  commitPass = true;
  lyrics.dispatchEvent(new Event('input', { bubbles: true }));
  commitPass = false;
  setText(document.querySelector('#pv-ai-compose-status'), mode === 'append' ? 'Trecho adicionado ao projeto.' : 'Texto aplicado ao projeto.');
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? 'Criando…' : 'Criar';
}

function setText(node, value) { if (node) node.textContent = String(value || ''); }

function viewport() {
  const v = visualViewport;
  if (!v) return;
  const inset = Math.max(0, innerHeight - v.height - v.offsetTop);
  document.documentElement.style.setProperty('--pv-keyboard-inset', `${Math.round(inset)}px`);
  document.documentElement.classList.toggle('pv-keyboard-open', inset > 120);
}

export function installCompositionProfessionalUI() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(decorate);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('input', onInputCapture, true);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('submit', onSubmitCapture, true);
  visualViewport?.addEventListener('resize', viewport);
  visualViewport?.addEventListener('scroll', viewport);
  decorate();
  viewport();
  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('input', onInputCapture, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('submit', onSubmitCapture, true);
    visualViewport?.removeEventListener('resize', viewport);
    visualViewport?.removeEventListener('scroll', viewport);
  };
}

installCompositionProfessionalUI();

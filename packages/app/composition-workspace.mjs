const VERSION = 'pablovoice_composition_workspace_v1';
const runtime = { observer: null, queued: false, applying: false };

const STRUCTURES = Object.freeze({
  livre: '',
  pop: 'Estrutura desejada: intro curta, verso, pré-refrão crescente, refrão forte, segundo verso, refrão, ponte contrastante, refrão final e outro.',
  hook: 'Estrutura desejada: chegar cedo ao hook, refrão memorável, pós-refrão claro e retornos com variação em vez de copiar o mesmo loop.',
  narrativa: 'Estrutura desejada: começar íntimo, aumentar tensão por seção, abrir no refrão e usar a ponte para mudar textura antes do último payoff.',
  groove: 'Estrutura desejada: groove como eixo da música, versos enxutos, viradas entre seções, refrão maior e evolução de densidade ao longo do arranjo.',
});

function queueSync() {
  if (runtime.queued) return;
  runtime.queued = true;
  queueMicrotask(() => {
    runtime.queued = false;
    syncWorkspace();
  });
}

function syncWorkspace() {
  if (runtime.applying) return;
  const form = document.querySelector('[data-song-create-form]');
  if (!form) return;
  runtime.applying = true;
  try {
    ensureBriefTextarea(form);
    const shell = ensureShell(form);
    moveCanonicalControls(form, shell);
    syncLyricsSummary(shell);
    syncPromptSummary(form, shell);
    document.documentElement.dataset.pvCompositionWorkspace = VERSION;
  } finally {
    runtime.applying = false;
  }
}

function ensureBriefTextarea(form) {
  const field = form.elements.brief;
  if (!field || field.tagName === 'TEXTAREA') {
    if (field && !field.dataset.pvArtistBrief) field.dataset.pvArtistBrief = field.value || '';
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.className = field.className;
  textarea.name = 'brief';
  textarea.maxLength = Number(field.maxLength) > 0 ? field.maxLength : 1200;
  textarea.required = field.required;
  textarea.rows = 5;
  textarea.value = field.value || '';
  textarea.placeholder = 'Descreva a música como falaria com um produtor: gênero, época, groove, instrumentos, energia, refrão, voz e o que não pode acontecer.';
  textarea.dataset.pvArtistBrief = textarea.value;
  field.replaceWith(textarea);
}

function ensureShell(form) {
  let shell = form.querySelector('[data-pv-composition-shell]');
  if (shell) return shell;
  shell = document.createElement('section');
  shell.className = 'pv-composition-shell';
  shell.dataset.pvCompositionShell = 'true';
  shell.innerHTML = `
    <header class="pv-composition-head">
      <div><span>COMPOSIÇÃO</span><h3>Da ideia ao take, sem misturar tudo numa tela só.</h3><p>Construa intenção, letra, arranjo e voz; depois a IA dirige a produção e envia ao motor musical.</p></div>
      <b data-pv-composition-summary>Direção aberta</b>
    </header>
    <nav class="pv-composition-rail" aria-label="Etapas da composição">
      <button type="button" data-pv-compose-jump="idea"><span>01</span>Ideia</button>
      <button type="button" data-pv-compose-jump="lyrics"><span>02</span>Letra</button>
      <button type="button" data-pv-compose-jump="arrangement"><span>03</span>Arranjo</button>
      <button type="button" data-pv-compose-jump="voice"><span>04</span>Voz</button>
      <button type="button" data-pv-compose-jump="create"><span>05</span>Produzir</button>
    </nav>
    <div class="pv-composition-panels">
      <article class="pv-composition-panel" data-pv-compose-panel="idea">
        <div class="pv-composition-panel-head"><span>01</span><div><b>Ideia & identidade</b><small>O que essa música precisa ser e sentir.</small></div></div>
        <div data-pv-compose-slot="idea"></div>
      </article>
      <article class="pv-composition-panel" data-pv-compose-panel="lyrics">
        <div class="pv-composition-panel-head"><span>02</span><div><b>Letra & hook</b><small>A letra continua no editor principal, mas entra de verdade na direção musical.</small></div></div>
        <div class="pv-composition-lyrics-state"><strong data-pv-lyrics-state>Sem letra ainda</strong><small data-pv-lyrics-detail>Você pode criar primeiro o instrumental ou escrever a letra.</small></div>
        <button class="pv-btn" type="button" data-pv-focus-lyrics>Editar letra</button>
      </article>
      <article class="pv-composition-panel" data-pv-compose-panel="arrangement">
        <div class="pv-composition-panel-head"><span>03</span><div><b>Arranjo & dinâmica</b><small>Defina como a música evolui, não só o gênero.</small></div></div>
        <div class="pv-composition-direction-grid">
          <label>Forma da música
            <select class="pv-field" data-pv-structure-intent>
              <option value="livre">Deixar a IA propor</option>
              <option value="pop">Verso → pré → refrão → ponte</option>
              <option value="hook">Hook cedo + pós-refrão</option>
              <option value="narrativa">Crescendo narrativo</option>
              <option value="groove">Groove conduzindo as seções</option>
            </select>
          </label>
          <label>Direção de arranjo
            <textarea class="pv-field" rows="3" maxlength="420" data-pv-arrangement-intent placeholder="Ex.: verso íntimo e seco, pré subindo, refrão abre estéreo, ponte tira a bateria e volta maior."></textarea>
          </label>
          <label>Preservar
            <input class="pv-field" maxlength="240" data-pv-preserve-intent placeholder="Ex.: letra, BPM, motivo de 3 notas, voz masculina">
          </label>
        </div>
        <div class="pv-composition-chips" aria-label="Atalhos de arranjo">
          <button type="button" data-pv-arrangement-chip="verso íntimo e com menos elementos">verso íntimo</button>
          <button type="button" data-pv-arrangement-chip="pré-refrão crescendo em tensão e densidade">pré subindo</button>
          <button type="button" data-pv-arrangement-chip="refrão maior, mais aberto e imediatamente reconhecível">refrão abre</button>
          <button type="button" data-pv-arrangement-chip="pós-refrão com motivo curto e memorável">pós claro</button>
          <button type="button" data-pv-arrangement-chip="ponte com mudança real de textura antes do último refrão">ponte contrasta</button>
          <button type="button" data-pv-arrangement-chip="evitar repetição de loop; variar fills, densidade e transições">menos repetição</button>
        </div>
        <div data-pv-compose-slot="advanced"></div>
      </article>
      <article class="pv-composition-panel" data-pv-compose-panel="voice">
        <div class="pv-composition-panel-head"><span>04</span><div><b>Voz & interpretação</b><small>Extensão, timbre, dicção e entrega da voz-guia.</small></div></div>
        <div data-pv-compose-slot="voice"></div>
      </article>
      <article class="pv-composition-panel emphasis" data-pv-compose-panel="create">
        <div class="pv-composition-panel-head"><span>05</span><div><b>Produzir take</b><small>A IA transforma a direção em uma instrução de produção e o motor gera áudio novo.</small></div></div>
        <div data-pv-compose-slot="create"></div>
      </article>
    </div>`;
  form.prepend(shell);
  return shell;
}

function moveCanonicalControls(form, shell) {
  const idea = shell.querySelector('[data-pv-compose-slot="idea"]');
  const advanced = shell.querySelector('[data-pv-compose-slot="advanced"]');
  const voice = shell.querySelector('[data-pv-compose-slot="voice"]');
  const create = shell.querySelector('[data-pv-compose-slot="create"]');
  const kind = form.querySelector('[data-pv-kind-switch]');
  const brief = form.elements.brief?.closest('label');
  const preview = form.querySelector('[data-pv-intent-preview]');
  [kind, brief, preview].filter(Boolean).forEach((node) => { if (node.parentElement !== idea) idea.appendChild(node); });

  const advancedDetails = form.querySelector('.pv-intimate-advanced');
  if (advancedDetails && advancedDetails.parentElement !== advanced) advanced.appendChild(advancedDetails);
  const vocal = form.querySelector('.pv-song-vocal-profile');
  if (vocal && vocal.parentElement !== voice) voice.appendChild(vocal);

  const unified = form.querySelector('[data-pv-unified-create-card]');
  const modes = form.querySelector('.pv-song-mode-grid');
  const status = form.querySelector('#pv-song-create-status');
  [unified, modes, status].filter(Boolean).forEach((node) => { if (node.parentElement !== create) create.appendChild(node); });
}

function syncLyricsSummary(shell) {
  const lyrics = String(document.querySelector('#lyrics')?.value || '').trim();
  const lines = lyrics ? lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  const sectionCount = lines.filter((line) => /^\s*\[(?:verse|verso|pre|pré|chorus|refr|bridge|ponte|post|pós)/i.test(line)).length;
  const words = lyrics ? lyrics.split(/\s+/).filter(Boolean).length : 0;
  const state = shell.querySelector('[data-pv-lyrics-state]');
  const detail = shell.querySelector('[data-pv-lyrics-detail]');
  if (!lyrics) {
    setText(state, 'Sem letra ainda');
    setText(detail, 'Instrumental primeiro continua disponível; a letra pode entrar depois.');
  } else {
    setText(state, `${words} palavras · ${lines.length} linhas`);
    setText(detail, sectionCount ? `${sectionCount} marcações de seção detectadas.` : 'A letra será usada para fraseado e direção vocal.');
  }
}

function syncPromptSummary(form, shell) {
  const brief = String(form.elements.brief?.dataset.pvArtistBrief ?? form.elements.brief?.value ?? '').trim();
  const arrangement = String(shell.querySelector('[data-pv-arrangement-intent]')?.value || '').trim();
  const preserve = String(shell.querySelector('[data-pv-preserve-intent]')?.value || '').trim();
  const parts = [brief && 'ideia', arrangement && 'arranjo', preserve && 'preservação'].filter(Boolean);
  setText(shell.querySelector('[data-pv-composition-summary]'), parts.length ? `${parts.length}/3 direções definidas` : 'Direção aberta');
}

function mergedBrief(form) {
  const shell = form.querySelector('[data-pv-composition-shell]');
  const field = form.elements.brief;
  const artist = String(field?.dataset.pvArtistBrief ?? field?.value ?? '').trim();
  const structureKey = String(shell?.querySelector('[data-pv-structure-intent]')?.value || 'livre');
  const arrangement = String(shell?.querySelector('[data-pv-arrangement-intent]')?.value || '').trim();
  const preserve = String(shell?.querySelector('[data-pv-preserve-intent]')?.value || '').trim();
  return [
    artist,
    STRUCTURES[structureKey] || '',
    arrangement ? `Direção de arranjo: ${arrangement}` : '',
    preserve ? `Preservar: ${preserve}.` : '',
  ].filter(Boolean).join('\n').slice(0, 1200);
}

function prepareDispatch(form) {
  const field = form.elements.brief;
  if (!field || form.dataset.pvCompositionDispatch === '1') return;
  const artist = String(field.dataset.pvArtistBrief ?? field.value ?? '');
  const merged = mergedBrief(form);
  if (!merged || merged === field.value) return;
  form.dataset.pvCompositionDispatch = '1';
  field.value = merged;
  queueMicrotask(() => {
    if (field.value === merged) field.value = artist;
    delete form.dataset.pvCompositionDispatch;
    syncPromptSummary(form, form.querySelector('[data-pv-composition-shell]'));
  });
}

function onInput(event) {
  const form = event.target.closest?.('[data-song-create-form]');
  if (form && event.target === form.elements.brief && form.dataset.pvCompositionDispatch !== '1') {
    event.target.dataset.pvArtistBrief = event.target.value;
  }
  if (event.target.matches?.('#lyrics,[data-pv-arrangement-intent],[data-pv-preserve-intent],[data-pv-structure-intent]') || form) queueSync();
}

function onClick(event) {
  const jump = event.target.closest('[data-pv-compose-jump]');
  if (jump) {
    event.preventDefault();
    document.querySelector(`[data-pv-compose-panel="${jump.dataset.pvComposeJump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const focusLyrics = event.target.closest('[data-pv-focus-lyrics]');
  if (focusLyrics) {
    event.preventDefault();
    const lyrics = document.querySelector('#lyrics');
    lyrics?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => lyrics?.focus?.(), 250);
    return;
  }
  const chip = event.target.closest('[data-pv-arrangement-chip]');
  if (chip) {
    event.preventDefault();
    const target = document.querySelector('[data-pv-arrangement-intent]');
    if (target) {
      const value = chip.dataset.pvArrangementChip || '';
      target.value = target.value.trim() ? `${target.value.trim()}; ${value}` : value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.focus();
    }
  }
}

function onCaptureClick(event) {
  const button = event.target.closest?.('[data-pv-unified-create],[data-song-create-hq]');
  if (!button) return;
  const form = button.closest('[data-song-create-form]');
  if (form) prepareDispatch(form);
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node && node.textContent !== text) node.textContent = text;
}

export function installCompositionWorkspace() {
  if (runtime.observer) return () => runtime.observer?.disconnect();
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('input', onInput, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('click', onCaptureClick, true);
  queueSync();
  return () => {
    runtime.observer?.disconnect();
    runtime.observer = null;
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('click', onCaptureClick, true);
  };
}

installCompositionWorkspace();
export const PABLOVOICE_COMPOSITION_WORKSPACE_VERSION = VERSION;

const REWRITES = Object.freeze([
  [/Take HQ com continuidade encontrado\./g, 'Take conectado com continuidade encontrado.'],
  [/Crie uma demo HQ com ID de continuidade para habilitar “Refazer HQ”\./g, 'Produza uma versão conectada para habilitar a edição seletiva por seção.'],
  [/take HQ/gi, 'take conectado'],
  [/regeneração HQ/gi, 'edição conectada'],
  [/motor Music v2/gi, 'produção conectada'],
  [/motor musical/gi, 'produção conectada'],
  [/Conecte sua sessão do PabloVoice para usar a regeneração HQ\./g, 'Reconheça este aparelho para usar a edição conectada.'],
]);

let observer = null;
let queued = false;

export function installSectionRegenerationProductUI() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(queueSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueSync();
  return () => {
    observer?.disconnect();
    observer = null;
  };
}

function queueSync() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    sync();
  });
}

function sync() {
  document.querySelectorAll('[data-music-section-regen]').forEach((button) => {
    if (!button.disabled) setText(button, '〰 Refazer seção');
    button.title = 'Criar uma nova versão apenas desta seção e preservar o restante do take.';
  });

  const readiness = document.querySelector('[data-music-regen-readiness]');
  if (readiness) {
    const strong = readiness.querySelector('strong');
    const copy = readiness.querySelector('span');
    if (readiness.classList.contains('ready')) {
      setText(strong, '〰 Edição por seção pronta');
      setText(copy, 'Existe um take conectado com continuidade. Você pode criar outra versão de uma seção sem refazer a música inteira.');
    } else {
      setText(strong, 'Edição por seção');
      setText(copy, 'Produza uma versão conectada para liberar novas versões seletivas. O mapa de seções continua editável normalmente.');
    }
  }

  const panel = document.querySelector('[data-music-regen-panel]');
  if (panel) {
    const eyebrow = panel.querySelector('.pv-music-regen-head small');
    if (eyebrow) setText(eyebrow, '〰 WAVE · EDIÇÃO SELETIVA');
    const safety = panel.querySelector('.pv-music-regen-safety');
    if (safety) {
      setText(safety.querySelector('b'), 'Preservar o resto da música');
      setText(safety.querySelector('span'), 'Só o intervalo selecionado recebe uma nova versão. O take anterior continua intacto para comparação e retorno.');
    }
    const submit = panel.querySelector('[data-music-regen-submit]');
    if (submit) {
      submit.classList.toggle('busy', submit.disabled);
      setText(submit, submit.disabled ? '〰 Criando seção…' : '〰 Criar nova versão');
    }
    rewriteNode(panel.querySelector('[data-music-regen-status]'));
  }

  document.querySelectorAll('.pv-toast').forEach(rewriteNode);
}

function rewriteNode(node) {
  if (!node) return;
  let text = String(node.textContent || '');
  for (const [pattern, replacement] of REWRITES) text = text.replace(pattern, replacement);
  setText(node, text);
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node && node.textContent !== text) node.textContent = text;
}

installSectionRegenerationProductUI();

export const SECTION_REGEN_PRODUCT_POLICY = Object.freeze({
  productLabel: 'Edição por seção',
  waveVisible: true,
  previousTakePreserved: true,
  providerBrandHiddenFromPrimaryUI: true,
  technicalContinuityIdHiddenFromPrimaryUI: true,
});

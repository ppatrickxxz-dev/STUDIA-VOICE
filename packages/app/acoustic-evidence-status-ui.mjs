import { getProject, listProjects } from './storage.mjs';
import { summarizePersistedAcousticEvidence } from './providers/src/remote-acoustic-evidence.mjs';

let observer;
let refreshTimer = 0;
let refreshing = false;

export function installAcousticEvidenceStatusUI() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => {
    injectEvidenceStatus();
    scheduleRefresh();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectEvidenceStatus();
  scheduleRefresh();
  document.addEventListener('visibilitychange', handleVisibility);
  return () => {
    observer?.disconnect();
    observer = null;
    clearTimeout(refreshTimer);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

function injectEvidenceStatus() {
  const panel = document.querySelector('#pv-ai-voice-harmony');
  if (!panel || panel.querySelector('#pv-acoustic-evidence-status')) return;

  const card = document.createElement('div');
  card.id = 'pv-acoustic-evidence-status';
  card.className = 'pv-note';
  card.setAttribute('role', 'status');
  card.dataset.voiceEvidence = 'pending';
  card.dataset.harmonyEvidence = 'pair_evidence_pending';
  card.textContent = 'Evidência acústica: identidade vocal ainda não medida. Harmonias high + low aguardam validação das duas camadas. Áudio pronto não significa voz aprovada.';

  const voiceList = panel.querySelector('#pv-ai-voice-list');
  if (voiceList) voiceList.insertAdjacentElement('beforebegin', card);
  else panel.append(card);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshEvidenceStatus(), 120);
}

async function refreshEvidenceStatus() {
  if (refreshing) return;
  const card = document.querySelector('#pv-acoustic-evidence-status');
  if (!card) return;
  refreshing = true;
  try {
    const projects = await listProjects();
    const active = projects[0];
    const project = active ? await getProject(active.id) : null;
    const summary = summarizePersistedAcousticEvidence(project?.tracks || []);
    renderEvidenceStatus(card, summary);
  } catch {
    setCard(card, 'pending', 'pair_evidence_pending', 'Evidência acústica: ainda não consegui ler as provas persistidas deste projeto. Áudio pronto não significa voz aprovada.');
  } finally {
    refreshing = false;
  }
}

function renderEvidenceStatus(card, summary) {
  const voice = summary.voice;
  const harmony = summary.harmony;
  const voiceState = voice.validated > 0 ? 'validated_available' : voice.state;
  const voiceText = voice.validated > 0
    ? `${voice.validated} variante(s) vocal(is) com identidade, timbre e qualidade técnica validados`
    : voice.failed > 0
      ? 'há evidência vocal recebida, mas nenhuma variante foi validada'
      : 'identidade vocal ainda não medida';
  const harmonyText = harmony.pairValidated
    ? 'high + low validadas dentro do mesmo par acústico'
    : harmony.state === 'pair_not_validated'
      ? 'há um par high + low correlacionado, mas pelo menos uma camada falhou na evidência acústica'
      : harmony.unpaired > 0
        ? 'há camadas com evidência, mas sem pairId suficiente para provar que high e low pertencem à mesma execução'
        : 'high + low ainda aguardam evidência acústica correlacionada';

  setCard(
    card,
    voiceState,
    harmony.state,
    `Evidência acústica — Voz: ${voiceText}. Harmonias: ${harmonyText}. Áudio pronto não significa voz aprovada.`,
  );
}

function setCard(card, voiceState, harmonyState, text) {
  card.dataset.voiceEvidence = voiceState;
  card.dataset.harmonyEvidence = harmonyState;
  if (card.textContent !== text) card.textContent = text;
}

function handleVisibility() {
  if (document.visibilityState === 'visible') scheduleRefresh();
}

import { RemoteAuthAdapter } from './remote-auth.mjs';
import { activeProjectSessionId, getAudioAsset, getProject, saveProject } from './storage.mjs';
import { auditGeneratedVocal } from './generated-vocal-audit.mjs';

const running = new Set();
const auth = new RemoteAuthAdapter();
let observer = null;
let queued = false;

auth.consumeBootstrapFragment?.();

export function installGeneratedVocalAuditRuntime() {
  if (observer) return disconnect;
  observer = new MutationObserver(queueAudit);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('online', queueAudit);
  document.addEventListener('pablovoice:project-updated', queueAudit);
  queueAudit();
  return disconnect;
}

function disconnect() {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('online', queueAudit);
  document.removeEventListener('pablovoice:project-updated', queueAudit);
}

function queueAudit() {
  if (queued || navigator.onLine === false) return;
  queued = true;
  queueMicrotask(async () => {
    queued = false;
    await auditPendingCandidates().catch((error) => console.error('PABLOVOICE_GENERATED_VOCAL_AUDIT_RUNTIME', error));
  });
}

export async function auditPendingCandidates() {
  if (navigator.onLine === false) return { audited: 0, pending: 0 };
  const projectId = activeProjectSessionId();
  if (!projectId) return { audited: 0, pending: 0 };
  const project = await getProject(projectId);
  if (!project) return { audited: 0, pending: 0 };
  const pending = (project.songCreation?.takes || []).filter((take) =>
    take?.validation?.vocalRequested === true
    && take?.validation?.vocalContentAudit === 'pending_acoustic_verification'
    && take?.remoteProjectId
    && take?.remoteAssetId
    && !running.has(take.id));
  if (!pending.length) return { audited: 0, pending: 0 };

  // Vocal candidates are never selectable merely because a file arrived.
  for (const take of pending) markCandidate(take.id, 'pending', 'Aguardando confirmação de voz cantada…');

  const session = await auth.ensureSession().catch(() => null);
  if (!session?.accessToken) return { audited: 0, pending: pending.length };

  let audited = 0;
  for (const take of pending) {
    running.add(take.id);
    markCandidate(take.id, 'auditing', 'Confirmando voz cantada…');
    try {
      const track = (project.tracks || []).find((item) => item.id === take.referenceTrackId);
      const localAsset = track?.assetId ? await getAudioAsset(track.assetId) : null;
      if (!localAsset?.blob) throw new Error('candidate_local_audio_missing');

      const proof = await auditGeneratedVocal({
        token: session.accessToken,
        remoteProjectId: take.remoteProjectId,
        sourceAssetId: take.remoteAssetId,
        fullMixBlob: localAsset.blob,
        onProgress: (current) => markCandidate(take.id, 'auditing', current.message || 'Confirmando voz cantada…'),
      });

      applyProof(project, take.id, proof);
      await saveProject(project);
      audited += 1;
      if (proof.ok) {
        markCandidate(take.id, 'verified', '✓ Voz cantada confirmada · letra ainda será conferida por transcrição');
      } else {
        markCandidate(take.id, 'rejected', `⚠ ${proof.message || 'Vocal não confirmado'}`);
      }
      document.dispatchEvent(new CustomEvent('pablovoice:generated-vocal-audited', {
        detail: { projectId: project.id, takeId: take.id, ok: proof.ok, code: proof.code },
      }));
    } catch (error) {
      const proof = { ok: false, code: 'vocal_audit_runtime_failed', message: error?.message || 'Não foi possível confirmar o vocal.' };
      applyProof(project, take.id, proof);
      await saveProject(project).catch(() => {});
      markCandidate(take.id, 'rejected', '⚠ Não foi possível confirmar que esta versão contém voz cantada');
    } finally {
      running.delete(take.id);
    }
  }
  updateCreatorStatus(project);
  return { audited, pending: pending.length };
}

function applyProof(project, takeId, proof) {
  const takes = (project.songCreation?.takes || []).map((take) => {
    if (take.id !== takeId) return take;
    const validation = {
      ...(take.validation || {}),
      vocalContentAudit: proof.ok ? 'acoustic_presence_verified' : 'acoustic_presence_rejected',
      acousticVocalProof: proof,
      lyricAdherence: proof.ok ? 'pending_transcription' : 'not_applicable_until_vocal_passes',
      auditedAt: Date.now(),
    };
    return { ...take, validation };
  });
  project.songCreation = { ...(project.songCreation || {}), takes };

  for (const track of project.tracks || []) {
    if (track.songTakeId !== takeId) continue;
    track.vocalContentAudit = proof.ok ? 'acoustic_presence_verified' : 'acoustic_presence_rejected';
    track.acousticVocalProof = proof;
  }
  project.updatedAt = Date.now();
}

function markCandidate(takeId, state, message) {
  const card = document.querySelector(`[data-candidate-take="${cssEscape(takeId)}"]`);
  if (!card) return;
  card.dataset.vocalAudit = state;
  const description = card.querySelector('.pv-card-head p');
  if (description) description.textContent = message;
  const choose = card.querySelector('[data-song-select-candidate]');
  if (!choose) return;

  if (state === 'verified') {
    choose.disabled = false;
    choose.textContent = 'Usar esta versão';
    return;
  }

  choose.disabled = true;
  if (state === 'rejected') choose.textContent = 'Vocal não confirmado';
  else if (state === 'auditing') choose.textContent = 'Confirmando vocal…';
  else choose.textContent = 'Aguardando confirmação vocal';
}

function updateCreatorStatus(project) {
  const vocalTakes = (project.songCreation?.takes || []).filter((take) => take?.validation?.vocalRequested === true);
  if (!vocalTakes.length) return;
  const verified = vocalTakes.filter((take) => take?.validation?.vocalContentAudit === 'acoustic_presence_verified').length;
  const rejected = vocalTakes.filter((take) => take?.validation?.vocalContentAudit === 'acoustic_presence_rejected').length;
  const status = document.querySelector('#pv-song-create-status');
  if (!status) return;
  if (verified) {
    status.textContent = `${verified} versão(ões) com voz cantada confirmada(s). A próxima prova é conferir aderência à letra.`;
    status.dataset.kind = 'ok';
  } else if (rejected) {
    status.textContent = 'As versões recebidas não passaram na confirmação acústica de vocal. Não serão tratadas como música cantada.';
    status.dataset.kind = 'error';
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

installGeneratedVocalAuditRuntime();

export const GENERATED_VOCAL_AUDIT_RUNTIME_POLICY = Object.freeze({
  automatic: true,
  blocksCandidateSelectionUntilPass: true,
  preservesRejectedAudioForInspection: true,
  projectProofPersisted: true,
  lyricAdherence: 'pending_transcription_after_acoustic_pass',
});

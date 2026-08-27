const REVISION = /\b(mas|deixa|deixe|torna|torne|menos|mais|troca|troque|muda|mude|melhora|melhore|reescreve|reescreva|refaz|refaça|ajusta|ajuste|encurta|encurte|alongue|mant[eé]m|preserva|preserve|simplifica|simplifique)\b/i;
const DRAFT_TARGET = /\b(rascunho|vers[aã]o|refr[aã]o|verso|ponte|trecho|letra|texto|parte|hook)\b/i;
const FOLLOW_UP = /\b(gostei|curti|ficou|mas|agora|essa|esse|isso|dessa|desse)\b/i;
const NEW_VARIANT = /\b(outro|outra|novo|nova|do zero|uma nova vers[aã]o|outra vers[aã]o)\b/i;
const AUDIO_DOMAIN = /\b(voz|vocal|mix|[aá]udio|faixa|volume|grave|agudo|baixo|bateria|instrumental|respira[cç][aã]o|sibil[aâ]ncia|compress[aã]o|compressor|equaliza[cç][aã]o|\beq\b|reverb|delay|pan|est[eé]reo)\b/i;

export function planPendingDraftRevision(message = '', context = {}) {
  const task = String(message || '').trim();
  const pending = normalizePendingDraft(context.pendingDraft);
  if (!task || !pending) return Object.freeze({ supported: false });
  if (AUDIO_DOMAIN.test(task) || NEW_VARIANT.test(task)) return Object.freeze({ supported: false });
  if (!REVISION.test(task) || (!DRAFT_TARGET.test(task) && !FOLLOW_UP.test(task))) {
    return Object.freeze({ supported: false });
  }

  const remoteTask = `Revise somente o rascunho pendente em context_pack.pending_draft. Pedido do usuário: ${task}`.slice(0, 4000);
  return Object.freeze({
    supported: true,
    blocked: false,
    kind: 'pmi_draft_revision_request',
    command: 'rewrite',
    targetSection: pending.targetSection,
    targetGenre: pending.targetGenre,
    pendingVersion: pending.version,
    task: task.slice(0, 4000),
    request: Object.freeze({
      command: 'rewrite',
      task: remoteTask,
      targetSection: pending.targetSection,
      targetGenre: pending.targetGenre,
      contextPack: Object.freeze({
        source: 'pablovoice-pmi-draft-revision',
        user_request: task.slice(0, 4000),
        pending_draft: pending.text,
        pending_draft_version: pending.version,
        pending_draft_command: pending.command,
        target_section: pending.targetSection,
        target_genre: pending.targetGenre,
        project_notes: String(context.notes || '').slice(0, 4000),
        current_lyrics: String(context.lyrics || '').slice(0, 12000),
        authorial_memory: context.authorialMemory || null,
      }),
      authorSamples: String(context.lyrics || '').trim() ? [String(context.lyrics).slice(0, 10000)] : [],
      constraints: Object.freeze({
        language: 'pt-BR',
        revise_pending_draft_only: true,
        preserve_authorial_voice: true,
        respect_authorial_memory: true,
        preserve_user_lines: false,
        minimal_change: true,
        no_artist_imitation: true,
        review_before_apply: true,
      }),
    }),
  });
}

export function normalizePendingDraft(value) {
  const text = String(value?.text || '').trim().slice(0, 12000);
  if (!text) return null;
  return Object.freeze({
    text,
    version: Math.max(1, Math.min(99, Math.floor(Number(value?.version) || 1))),
    command: cleanOptional(value?.command),
    targetSection: cleanOptional(value?.targetSection),
    targetGenre: cleanOptional(value?.targetGenre),
  });
}

function cleanOptional(value) {
  const text = String(value || '').trim().slice(0, 64);
  return text || null;
}

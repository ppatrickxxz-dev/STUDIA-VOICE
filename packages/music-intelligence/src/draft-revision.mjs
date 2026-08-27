const REVISION = /\b(mas|deixa|deixe|faz|faça|torna|torne|menos|mais|troca|troque|muda|mude|melhora|melhore|reescreve|reescreva|refaz|refaça|ajusta|ajuste|encurta|encurte|alongue|mant[eé]m|preserva|preserve)\b/i;
const DRAFT_REFERENCE = /\b(esse|essa|isso|rascunho|vers[aã]o|refr[aã]o|verso|ponte|trecho|letra|texto|parte)\b/i;

export function planPendingDraftRevision(message = '', context = {}) {
  const task = String(message || '').trim();
  const pending = normalizePendingDraft(context.pendingDraft);
  if (!task || !pending || !REVISION.test(task) || !DRAFT_REFERENCE.test(task)) {
    return Object.freeze({ supported: false });
  }

  return Object.freeze({
    supported: true,
    blocked: false,
    kind: 'pmi_draft_revision_request',
    command: 'rewrite',
    targetSection: pending.targetSection || null,
    task: task.slice(0, 4000),
    request: Object.freeze({
      command: 'rewrite',
      task: task.slice(0, 4000),
      targetSection: pending.targetSection || null,
      targetGenre: pending.targetGenre || null,
      contextPack: Object.freeze({
        source: 'pablovoice-pmi-draft-revision',
        pending_draft: pending.text,
        pending_draft_command: pending.command || null,
        target_section: pending.targetSection || null,
        target_genre: pending.targetGenre || null,
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
        minimal_change: true,
        no_artist_imitation: true,
        review_before_apply: true,
      }),
    }),
  });
}

function normalizePendingDraft(value) {
  const text = String(value?.text || '').trim().slice(0, 12000);
  if (!text) return null;
  return Object.freeze({
    text,
    command: String(value?.command || '').slice(0, 64) || null,
    targetSection: String(value?.targetSection || '').slice(0, 64) || null,
    targetGenre: String(value?.targetGenre || '').slice(0, 64) || null,
  });
}

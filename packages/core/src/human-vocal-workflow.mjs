export const HUMAN_VOCAL_WORKFLOW_SCHEMA = 'pablovoice_human_vocal_workflow_v1';
export const GUIDE_REPLACEMENT_SOURCE = 'human_vocal_guide_replacement_v1';

export function createSectionRecordingIntent({ project, takeId, sectionId } = {}) {
  const take = (project?.songCreation?.takes || []).find((item) => item.id === takeId)
    || (project?.songCreation?.takes || []).find((item) => item.id === project?.songCreation?.latestTakeId);
  if (!take) throw new Error('Take musical não encontrado.');
  const section = (take.sections || []).find((item) => item.id === sectionId);
  if (!section) throw new Error('Seção musical não encontrada.');
  const lines = (take.guideLines || []).filter((line) => line.sectionId === section.id).map((line) => line.text).filter(Boolean);
  return Object.freeze({
    schema: HUMAN_VOCAL_WORKFLOW_SCHEMA,
    projectId: project.id,
    takeId: take.id,
    sectionId: section.id,
    sectionLabel: section.label || section.id,
    startSeconds: Number(section.startSeconds),
    endSeconds: Number(section.endSeconds),
    guideTrackId: take.guideTrackId || null,
    lyrics: lines.join('\n').slice(0, 4000),
    createdAt: Date.now(),
  });
}

export function attachHumanVocalTake(project, track, intent, now = Date.now()) {
  if (!project?.id || !track?.id || intent?.schema !== HUMAN_VOCAL_WORKFLOW_SCHEMA) throw new TypeError('Gravação guiada inválida.');
  if (intent.projectId !== project.id) throw new Error('A gravação pertence a outro projeto.');
  const start = Math.max(0, Number(intent.startSeconds) || 0);
  const sectionEnd = Math.max(start, Number(intent.endSeconds) || start);
  const recordedEnd = Math.min(sectionEnd, start + Math.max(0, Number(track.duration) || 0));
  Object.assign(track, {
    kind: 'recording',
    role: 'human_lead_take',
    songTakeId: intent.takeId,
    sectionId: intent.sectionId,
    offset: start,
    guideReplacement: true,
    vocalistSource: 'human_recording',
  });
  track.effects = { ...track.effects, clean: true, compressor: true, normalize: true };

  const guide = (project.tracks || []).find((candidate) => candidate.id === intent.guideTrackId);
  if (guide && recordedEnd > start) {
    const prior = Array.isArray(guide.regionAutomation) ? guide.regionAutomation : [];
    guide.regionAutomation = [
      ...prior.filter((event) => !(event?.source === GUIDE_REPLACEMENT_SOURCE && event?.sectionId === intent.sectionId)),
      {
        id: `guide_replace_${intent.sectionId}_${track.id}`,
        kind: 'gain',
        startSeconds: start,
        endSeconds: recordedEnd,
        gainDb: -60,
        confidence: 1,
        source: GUIDE_REPLACEMENT_SOURCE,
        sectionId: intent.sectionId,
        replacementTrackId: track.id,
        enabled: true,
      },
    ];
    guide.updatedAt = now;
  }

  const workflow = project.humanVocalWorkflow?.schema === HUMAN_VOCAL_WORKFLOW_SCHEMA
    ? structuredClone(project.humanVocalWorkflow)
    : { schema: HUMAN_VOCAL_WORKFLOW_SCHEMA, sections: {} };
  const previous = workflow.sections[intent.sectionId] || { takes: [] };
  workflow.sections[intent.sectionId] = {
    ...previous,
    label: intent.sectionLabel,
    startSeconds: start,
    endSeconds: sectionEnd,
    guideTrackId: intent.guideTrackId,
    takes: [...(previous.takes || []), track.id],
    activeTakeId: track.id,
    status: recordedEnd >= sectionEnd - 0.15 ? 'replaced' : 'partial',
    updatedAt: now,
  };
  workflow.updatedAt = now;
  project.humanVocalWorkflow = workflow;
  return { project, track, guideTrack: guide || null, section: workflow.sections[intent.sectionId] };
}

export function vocalWorkflowProgress(project, takeId = null) {
  const take = (project?.songCreation?.takes || []).find((item) => item.id === (takeId || project?.songCreation?.latestTakeId));
  const sections = (take?.sections || []).filter((section) => !['intro', 'outro'].includes(section.id));
  const states = project?.humanVocalWorkflow?.sections || {};
  const replaced = sections.filter((section) => states[section.id]?.status === 'replaced').length;
  const partial = sections.filter((section) => states[section.id]?.status === 'partial').length;
  return Object.freeze({ total: sections.length, replaced, partial, remaining: Math.max(0, sections.length - replaced), percent: sections.length ? Math.round(replaced / sections.length * 100) : 0 });
}

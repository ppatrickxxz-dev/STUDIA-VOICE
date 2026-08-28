import { planSectionMixAB, buildSectionMixABVariant, SECTION_MIX_AB_MODES } from './core/src/section-mix-ab.mjs';
import { auditionConfirmedSection, getSectionAuditionStatus, stopSectionAudition } from './section-audition-runtime.mjs';

let status = Object.freeze({
  variant: null,
  mode: SECTION_MIX_AB_MODES.ALL,
  projectId: null,
  sectionId: null,
  comparedEvents: 0,
  removedEvents: 0,
});

export async function auditionSectionMixAB(project, section, variant = 'B', mode = SECTION_MIX_AB_MODES.ALL) {
  const command = {
    section: section?.kind,
    occurrence: occurrenceForSection(project?.arrangementMap, section?.id, section?.kind),
    mode,
  };
  const plan = planSectionMixAB(project, command);
  if (!plan.ok) {
    const error = new Error(abRuntimeError(plan));
    error.code = plan.reason;
    throw error;
  }
  if (plan.section.id !== section?.id) throw new Error('A seção mudou desde que o A/B foi aberto. Abra a comparação novamente.');

  const prepared = buildSectionMixABVariant(plan.project, plan.section.id, variant, plan.mode);
  await auditionConfirmedSection(prepared.project, plan.section, { mode: 'processed' });
  status = freezeStatus({
    variant: prepared.variant,
    mode: plan.mode,
    projectId: prepared.project.id,
    sectionId: plan.section.id,
    comparedEvents: plan.matches.length,
    removedEvents: prepared.removed.length,
  });
  return getSectionMixABStatus();
}

export function stopSectionMixAB() {
  stopSectionAudition();
  return getSectionMixABStatus();
}

export function getSectionMixABStatus() {
  const audition = getSectionAuditionStatus();
  return {
    ...status,
    playing: Boolean(audition.playing),
    position: audition.position,
    startSeconds: audition.startSeconds,
    endSeconds: audition.endSeconds,
  };
}

function occurrenceForSection(map, sectionId, kind) {
  const same = (map?.sections || [])
    .filter((section) => section?.kind === kind && section?.timingStatus === 'confirmed' && Number(section?.confidence || 0) >= 0.8)
    .sort((a, b) => Number(a.startSeconds || 0) - Number(b.startSeconds || 0));
  const index = same.findIndex((section) => section.id === sectionId);
  return index >= 0 ? index + 1 : null;
}

function abRuntimeError(plan) {
  if (plan.reason === 'nothing_to_compare') return 'Não há ajustes regionais do Pablo nessa seção para comparar.';
  if (plan.reason === 'missing_confirmed_section') return 'A seção ainda não tem timing confirmado para comparação.';
  if (plan.reason === 'missing_confirmed_end') return 'A seção ainda não tem fim confirmado para comparação.';
  if (plan.reason === 'ambiguous_occurrence') return 'Há mais de uma ocorrência dessa seção. Abra a comparação indicando qual delas.';
  return 'Não consegui preparar o A/B dessa seção com segurança.';
}

function freezeStatus(value) {
  return Object.freeze({
    variant: value.variant || null,
    mode: value.mode || SECTION_MIX_AB_MODES.ALL,
    projectId: value.projectId || null,
    sectionId: value.sectionId || null,
    comparedEvents: Number(value.comparedEvents || 0),
    removedEvents: Number(value.removedEvents || 0),
  });
}

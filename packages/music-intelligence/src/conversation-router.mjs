import { respondToMusicCreation as respondToMusicCreationLegacy } from './session-engine.mjs';
import { interpretMusicalIntent } from './musical-intent.mjs';
import { routeMusicalIntent } from './operation-router.mjs';

export function respondToMusicCreation(message = '', context = {}) {
  const intent = interpretMusicalIntent(message, context);
  if (intent.supported) {
    const operationRoute = routeMusicalIntent(intent, context);
    return Object.freeze({
      supported: true,
      kind: 'pmi_musical_intent_plan',
      musicalIntent: intent,
      operationRoute,
      reply: describeIntent(intent, operationRoute),
      reviewRequired: true,
      canApply: false,
      session: context?.pmiSession || null,
    });
  }
  return respondToMusicCreationLegacy(message, context);
}

function describeIntent(intent, operationRoute) {
  if (intent.versionReference === 'prefer_previous') {
    return 'Entendi que você prefere a versão anterior. Mantive o projeto intacto e preparei a referência ao histórico de takes para revisão.';
  }

  const parts = [];
  if (intent.scope?.section) parts.push(`seção: ${humanSection(intent.scope.section)}`);
  if (intent.scope?.target) parts.push(`alvo: ${humanTarget(intent.scope.target)}`);
  const positive = intent.style?.positive || [];
  const negative = intent.style?.negative || [];
  if (positive.length) parts.push(`reforçar: ${positive.join(', ')}`);
  if (negative.length) parts.push(`evitar: ${negative.join(', ')}`);

  const deltaSummary = Object.entries(intent.deltas || {})
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${key} ${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}`);
  if (deltaSummary.length) parts.push(`ajustes: ${deltaSummary.join(', ')}`);
  if (intent.scope?.preserveUnselected) parts.push('preservar o restante');
  if (operationRoute?.executor) parts.push(`rota: ${humanExecutor(operationRoute.executor)}`);

  return `Entendi a direção musical${parts.length ? ` — ${parts.join(' · ')}` : ''}. Preparei um plano revisável; ainda não alterei o áudio.`;
}

function humanSection(section) {
  return ({ chorus: 'refrão', pre_chorus: 'pré-refrão', verse: 'verso', bridge: 'ponte', post_chorus: 'pós-refrão', intro: 'intro', outro: 'outro' })[section] || section;
}

function humanTarget(target) {
  return ({ drums: 'bateria', bass: 'baixo', synth: 'synth', piano: 'piano/teclas', guitar: 'guitarra/violão', arrangement: 'arranjo', mix: 'mix' })[target] || target;
}

function humanExecutor(executor) {
  return ({ version_history: 'histórico de takes', beat_lab: 'Beat Lab', instrument_lab: 'Instrument Lab/MIDI', audio_dsp: 'DSP', music_generation: 'regeneração musical', review_only: 'revisão' })[executor] || executor;
}

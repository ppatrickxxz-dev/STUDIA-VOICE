import { learnChoice, createAuthorialMemory } from './authorial-memory.mjs';

const REJECT = /^(?:pablo[,\s]*)?(?:não use|nao use|evita|evite|não quero|nao quero|não gosto de|nao gosto de)\s+(?:a\s+palavra\s+|o\s+termo\s+|a\s+expressão\s+|a\s+expressao\s+)?["“']?(.+?)["”']?[.!]?$/i;
const ACCEPT = /^(?:pablo[,\s]*)?(?:gosto de|prefiro|quero manter|usa mais|use mais)\s+(?:a\s+palavra\s+|o\s+termo\s+|a\s+expressão\s+|a\s+expressao\s+)?["“']?(.+?)["”']?[.!]?$/i;

export function parseAuthorialFeedback(message = '') {
  const source = String(message || '').trim();
  const rejected = source.match(REJECT);
  const accepted = rejected ? null : source.match(ACCEPT);
  const match = rejected || accepted;
  if (!match) return Object.freeze({ supported: false });
  const value = cleanValue(match[1]);
  if (!value || value.length > 160) return Object.freeze({ supported: false });
  const decision = rejected ? 'rejected' : 'accepted';
  const category = classifyCategory(value);
  return Object.freeze({ supported: true, decision, category, value });
}

export function applyAuthorialFeedback(memory, feedback) {
  if (!feedback?.supported) throw new Error('supported_authorial_feedback_required');
  return learnChoice(createAuthorialMemory(memory || {}), {
    decision: feedback.decision,
    category: feedback.category,
    value: feedback.value,
  });
}

export function respondToAuthorialFeedback(message = '', context = {}) {
  const feedback = parseAuthorialFeedback(message);
  if (!feedback.supported) return Object.freeze({ supported: false });
  const authorialMemory = applyAuthorialFeedback(context.authorialMemory || {}, feedback);
  const verb = feedback.decision === 'rejected' ? 'evitar' : 'priorizar';
  return Object.freeze({
    supported: true,
    kind: 'pmi_authorial_feedback',
    feedback,
    authorialMemory,
    reply: `Guardei isso para este projeto: ${verb} “${feedback.value}”. Não alterei sua letra automaticamente.`,
  });
}

function cleanValue(value) {
  return String(value || '').trim().replace(/^["“']+|["”']+$/g, '').replace(/[.!?]+$/g, '').trim();
}

function classifyCategory(value) {
  const text = String(value).toLowerCase();
  if (/\b(refrão|refrao|verso|ponte|pré-refrão|pre-refrao|estrutura)\b/.test(text)) return 'structure';
  return text.split(/\s+/).filter(Boolean).length <= 4 ? 'term' : 'pattern';
}

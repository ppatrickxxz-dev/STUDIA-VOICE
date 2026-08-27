import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConcept } from '../src/concept-engine.mjs';
import { startCompositionSession, critiqueDraft } from '../src/session-engine.mjs';
import { createAuthorialMemory, learnChoice } from '../src/authorial-memory.mjs';

test('concept engine preserves the user premise instead of replacing it', () => {
  const brief = 'Uma viagem que não chegou ao destino; a aventura foi o que aconteceu no caminho.';
  const result = buildConcept(brief);
  assert.equal(result.premise, brief);
  assert.ok(result.emotions.includes('descoberta'));
});

test('composition session starts from concept before forcing lyrics', () => {
  const session = startCompositionSession({ brief: 'Um encontro e desencontro durante uma viagem.' });
  assert.equal(session.phase, 'discover');
  assert.equal(session.authorialGuard.preserveUserLines, true);
  assert.equal(session.authorialGuard.requireReasonBeforeRewrite, true);
  assert.ok(session.nextActions.some((item) => item.includes('refrão')));
});

test('existing lyrics are analyzed without deleting the original', () => {
  const lyrics = '[Verso]\nHoje eu saí sem procurar\nMas dei de cara com você\n[Refrão]\nAmanhã a gente vê';
  const session = startCompositionSession({ brief: 'Flerte sem promessa', lyrics });
  assert.equal(session.phase, 'develop');
  assert.ok(session.lyricAnalysis.lines.length >= 3);
  assert.ok(critiqueDraft(session).metrics.singability >= 0);
});

test('authorial memory learns accepted and rejected choices as evidence', () => {
  const base = createAuthorialMemory();
  const accepted = learnChoice(base, { decision: 'accepted', category: 'hook', value: 'amanhã a gente vê' });
  const rejected = learnChoice(accepted, { decision: 'rejected', category: 'language', value: 'frase genérica' });
  assert.equal(rejected.evidenceCount, 2);
  assert.ok(rejected.acceptedPatterns.includes('hook:amanhã a gente vê'));
  assert.ok(rejected.rejectedPatterns.includes('language:frase genérica'));
});

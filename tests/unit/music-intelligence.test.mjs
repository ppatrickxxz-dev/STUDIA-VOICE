import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractConcept,
  analyzeRhymeArchitecture,
  createAuthorialProfile,
  learnAuthorialDecision,
  evaluateAuthorialFit,
  critiqueDraft,
  isMusicCreationRequest,
  startCompositionSession,
  respondToMusicCreation,
} from '../../packages/music-intelligence/src/index.mjs';

test('PMI extracts a narrative concept and three directions', () => {
  const result = extractConcept('Uma viagem que não chegou ao destino e a aventura foi o caminho.');
  assert.equal(result.directions.length, 3);
  assert.equal(result.pointOfView, 'aberto');
  assert.match(result.tension, /plano inicial/);
  assert.match(result.payoff, /percurso/);
});

test('PMI builds a composition session without requiring a remote model', () => {
  const session = startCompositionSession({ idea: 'Encontro e desencontro numa viagem', genre: 'R&B' });
  assert.equal(session.engine, 'pmi-music-1.0');
  assert.equal(session.stage, 'concept');
  assert.ok(session.structure.includes('pré-refrão'));
  assert.equal(session.hookSeeds.length, 3);
});

test('PMI recognizes conversational music creation requests', () => {
  assert.equal(isMusicCreationRequest('Pablo, quero fazer uma música sobre uma viagem que deu errado'), true);
  assert.equal(isMusicCreationRequest('aumenta o volume da faixa'), false);
  const answer = respondToMusicCreation('Quero criar uma música sobre desejo que a pessoa tenta negar');
  assert.equal(answer.supported, true);
  assert.equal(answer.kind, 'pmi_music_session');
  assert.match(answer.reply, /três caminhos/i);
});

test('authorial memory learns accepted and rejected decisions', () => {
  let profile = createAuthorialProfile();
  profile = learnAuthorialDecision(profile, { kind: 'term', value: 'promessa', accepted: false });
  profile = learnAuthorialDecision(profile, { kind: 'term', value: 'malícia', accepted: true });
  const fit = evaluateAuthorialFit('Sem promessa, só malícia', profile);
  assert.equal(fit.passesHardAvoids, false);
  assert.deepEqual(fit.avoidedHits, ['promessa']);
  assert.deepEqual(fit.preferredHits, ['malícia']);
});

test('critic returns prioritized feedback and rhyme architecture', () => {
  const draft = `[Verso]\nHoje eu saí sem procurar\nMas dei de cara com você\nUm olhar demorou demais\nPra eu fingir não entender`;
  const rhyme = analyzeRhymeArchitecture(draft);
  assert.ok(Number.isFinite(rhyme.singability));
  const critic = critiqueDraft(draft, { concept: extractConcept('um flerte que começa no olhar') });
  assert.ok(Array.isArray(critic.issues));
  assert.ok(Array.isArray(critic.strengths));
});

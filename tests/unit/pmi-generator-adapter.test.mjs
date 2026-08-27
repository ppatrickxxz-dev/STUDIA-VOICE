import test from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitGenerationRequest, planComposerGeneration } from '../../packages/music-intelligence/src/index.mjs';

test('a broad creation idea stays local instead of silently calling the remote Composer', () => {
  assert.equal(isExplicitGenerationRequest('Quero criar uma música sobre uma viagem que não chegou ao destino'), false);
  assert.equal(planComposerGeneration('Quero criar uma música sobre uma viagem que não chegou ao destino').supported, false);
});

test('explicit refrain writing becomes a reviewed generate request with PMI context', () => {
  const plan = planComposerGeneration('Escreve um refrão dessa ideia', {
    lyrics: '[Verso]\nAté onde deu',
    notes: 'R&B íntimo com contraste no refrão',
    preset: 'music',
    authorialMemory: {
      schema: 'pmi_authorial_memory_v1',
      avoid: ['promessa'],
      acceptedPatterns: ['term:caminho'],
      rejectedPatterns: ['term:promessa'],
      evidenceCount: 2,
    },
  });
  assert.equal(plan.supported, true);
  assert.equal(plan.blocked, false);
  assert.equal(plan.command, 'generate');
  assert.equal(plan.targetSection, 'refrão');
  assert.equal(plan.request.contextPack.source, 'pablovoice-pmi-composer');
  assert.equal(plan.request.contextPack.project_notes, 'R&B íntimo com contraste no refrão');
  assert.deepEqual(plan.request.contextPack.authorial_memory.avoid, ['promessa']);
  assert.equal(plan.request.constraints.review_before_apply, true);
  assert.equal(plan.request.constraints.preserve_authorial_voice, true);
});

test('continuation and rewrite fail closed when there is no current lyric', () => {
  const continuation = planComposerGeneration('Continua esse verso', { lyrics: '' });
  assert.equal(continuation.supported, true);
  assert.equal(continuation.blocked, true);
  assert.equal(continuation.reason, 'lyrics_required');
  assert.equal(continuation.command, 'continue_section');

  const rewrite = planComposerGeneration('Reescreve esse refrão sem perder meu jeito', { lyrics: '' });
  assert.equal(rewrite.blocked, true);
  assert.equal(rewrite.command, 'rewrite');
});

test('rewrite preserves user lines and requests minimal change', () => {
  const plan = planComposerGeneration('Reescreve esse refrão sem perder meu jeito', {
    lyrics: '[Refrão]\nAmanhã a gente vê',
  });
  assert.equal(plan.command, 'rewrite');
  assert.equal(plan.targetSection, 'refrão');
  assert.equal(plan.request.constraints.preserve_user_lines, true);
  assert.equal(plan.request.constraints.minimal_change, true);
  assert.deepEqual(plan.request.authorSamples, ['[Refrão]\nAmanhã a gente vê']);
});

test('genre adaptation requires existing text and records the target genre', () => {
  const plan = planComposerGeneration('Adapta essa letra pra funk', {
    lyrics: '[Verso]\nHoje eu saí sem procurar',
  });
  assert.equal(plan.command, 'adapt_genre');
  assert.equal(plan.targetGenre, 'funk');
  assert.equal(plan.blocked, false);
});

test('audio editing language is not mistaken for songwriting generation', () => {
  assert.equal(isExplicitGenerationRequest('Melhora esse mix e deixa minha voz na frente'), false);
  assert.equal(isExplicitGenerationRequest('Transforma isso em instrumento'), false);
});

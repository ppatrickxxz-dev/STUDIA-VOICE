import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionHereCommand } from '../../packages/core/src/section-here-command.mjs';

test('Pablo recognizes conversational section here commands', () => {
  assert.deepEqual(parseSectionHereCommand('marca o refrão aqui'), { section: 'chorus', label: 'Refrão' });
  assert.deepEqual(parseSectionHereCommand('o refrão começa aqui'), { section: 'chorus', label: 'Refrão' });
  assert.deepEqual(parseSectionHereCommand('marca a ponte aqui'), { section: 'bridge', label: 'Ponte' });
  assert.deepEqual(parseSectionHereCommand('marca o pré-refrão aqui'), { section: 'pre_chorus', label: 'Pré-refrão' });
  assert.deepEqual(parseSectionHereCommand('o verso inicia aqui'), { section: 'verse', label: 'Verso' });
});

test('lyrics headings and unrelated uses of aqui are not treated as timing evidence', () => {
  assert.equal(parseSectionHereCommand('[Refrão]\nEu volto aqui'), null);
  assert.equal(parseSectionHereCommand('escreve um refrão aqui pra mim'), null);
  assert.equal(parseSectionHereCommand('faz uma virada aqui'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionEndHereCommand, parseSectionHereCommand } from '../../packages/core/src/section-here-command.mjs';

test('Pablo recognizes conversational section here commands', () => {
  assert.deepEqual(parseSectionHereCommand('marca o refrão aqui'), { section: 'chorus', label: 'Refrão' });
  assert.deepEqual(parseSectionHereCommand('o refrão começa aqui'), { section: 'chorus', label: 'Refrão' });
  assert.deepEqual(parseSectionHereCommand('marca a ponte aqui'), { section: 'bridge', label: 'Ponte' });
  assert.deepEqual(parseSectionHereCommand('marca o pré-refrão aqui'), { section: 'pre_chorus', label: 'Pré-refrão' });
  assert.deepEqual(parseSectionHereCommand('o verso inicia aqui'), { section: 'verse', label: 'Verso' });
});

test('Pablo recognizes conversational section end at here commands independently from starts', () => {
  assert.deepEqual(parseSectionEndHereCommand('o refrão termina aqui'), { section: 'chorus', label: 'Refrão' });
  assert.deepEqual(parseSectionEndHereCommand('refrão acaba aqui'), { section: 'chorus', label: 'Refrão' });
  assert.deepEqual(parseSectionEndHereCommand('termina a ponte aqui'), { section: 'bridge', label: 'Ponte' });
  assert.deepEqual(parseSectionEndHereCommand('marca o fim do pré-refrão aqui'), { section: 'pre_chorus', label: 'Pré-refrão' });
  assert.equal(parseSectionHereCommand('o refrão termina aqui'), null);
});

test('lyrics headings and unrelated uses of aqui are not treated as timing evidence', () => {
  assert.equal(parseSectionHereCommand('[Refrão]\nEu volto aqui'), null);
  assert.equal(parseSectionEndHereCommand('[Refrão]\nTermina aqui'), null);
  assert.equal(parseSectionHereCommand('escreve um refrão aqui pra mim'), null);
  assert.equal(parseSectionEndHereCommand('faz uma virada no fim do refrão aqui'), null);
  assert.equal(parseSectionHereCommand('faz uma virada aqui'), null);
});

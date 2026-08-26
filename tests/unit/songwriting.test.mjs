import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLyrics, classifyStructure, estimateSyllables, rhymeKey, rhymeSuggestions } from '../../packages/songwriting/src/analyzer.mjs';

test('PT-BR analyzer identifies sections, line metrics, and rhyme families', () => {
  const text = '[Verso]\nEu carrego a verdade\nNo silêncio da cidade\n[Refrão]\nAcendo a minha luz\nE o meu caminho conduz';
  const analysis = analyzeLyrics(text);
  assert.equal(analysis.lines.length, 4);
  assert.ok(analysis.rhymeCoverage >= 50);
  assert.deepEqual(classifyStructure(text), ['verso', 'refrão']);
  assert.equal(rhymeKey('verdade'), rhymeKey('cidade'));
});

test('rhyme dictionary and syllable estimator return real local results', () => {
  assert.ok(rhymeSuggestions('coração').includes('canção'));
  assert.ok(estimateSyllables('Sua ideia ganha som') >= 6);
});


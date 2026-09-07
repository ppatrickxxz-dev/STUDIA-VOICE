import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPabloMusicV2Plan, isInstrumentalPlan, productionBriefStyles } from '../../services/providers/elevenmusic.mjs';

const sections = [
  { id: 'intro', label: 'Intro', startBeat: 0, endBeat: 8, startSeconds: 0, endSeconds: 4, energy: 0.25 },
  { id: 'verso_1', label: 'Verso 1', startBeat: 8, endBeat: 24, startSeconds: 4, endSeconds: 12, energy: 0.48 },
  { id: 'refrão', label: 'Refrão', startBeat: 24, endBeat: 40, startSeconds: 12, endSeconds: 20, energy: 0.9 },
];

test('long creative briefs compile into short role-aware production directions', () => {
  const styles = productionBriefStyles('R&B 2000s sensual; groove sincopado e bateria solta; baixo redondo pulsante; synths escuros, pads e plucks; refrão abrindo com motivo de três notas; pouca guitarra acústica; acabamento moderno e elegante');
  assert.ok(styles.length >= 4);
  assert.ok(styles.length <= 6);
  assert.ok(styles.some((style) => /groove sincopado/i.test(style)));
  assert.ok(styles.some((style) => /baixo redondo/i.test(style)));
  assert.ok(styles.some((style) => /synths escuros/i.test(style)));
  assert.ok(styles.some((style) => /refrão abrindo/i.test(style)));
  assert.ok(styles.every((style) => style.length <= 150));
});

test('placeholder synth-guide words are recognized as instrumental intent', () => {
  const placeholder = ['guia', 'melódica', 'para', 'cantar'].map((text, index) => ({ text, startBeat: 8 + index * 4 }));
  assert.equal(isInstrumentalPlan({}, placeholder), true);
  assert.equal(isInstrumentalPlan({ creationMode: 'instrumental_first' }, [{ text: 'qualquer letra' }]), true);
  assert.equal(isInstrumentalPlan({}, [{ text: 'Quando a cidade apaga' }]), false);
});

test('instrumental plan never leaks local guide placeholders as provider lyrics', () => {
  const plan = buildPabloMusicV2Plan({
    plan: {
      brief: 'Pop R&B escuro, bateria sincopada, baixo redondo, synth pads, refrão abrindo',
      genre: 'rnb',
      mood: 'íntimo e noturno',
      bpm: 112,
      key: 'A',
      mode: 'minor',
      sections,
      guideLines: [
        { text: 'guia', startBeat: 8 },
        { text: 'melódica', startBeat: 12 },
        { text: 'para', startBeat: 16 },
        { text: 'cantar', startBeat: 20 },
      ],
    },
    negativeStyles: ['dembow pesado', 'trap'],
  });

  assert.equal(plan.chunks.length, sections.length);
  for (const chunk of plan.chunks) {
    assert.match(chunk.text, /instrumental\]$/i);
    assert.doesNotMatch(chunk.text, /guia|melódica|para|cantar/i);
    assert.ok(chunk.negative_styles.includes('lead vocals'));
    assert.ok(chunk.negative_styles.includes('sung lyrics'));
    assert.ok(chunk.negative_styles.includes('vocal chops'));
    assert.ok(chunk.negative_styles.includes('dembow pesado'));
    assert.ok(chunk.positive_styles.some((style) => /instrumental-only production/i.test(style)));
  }
  assert.ok(plan.chunks[2].positive_styles.some((style) => /chorus opens wider/i.test(style)));
});

test('lyric-guided plans keep lyrics but separate instrumental and vocal roles', () => {
  const result = buildPabloMusicV2Plan({
    plan: {
      brief: 'R&B 2000s com grave pulsante e synths suaves',
      genre: 'rnb',
      mood: 'sensual',
      bpm: 96,
      key: 'F',
      mode: 'minor',
      sections,
      guideLines: [
        { text: 'Eu chego perto', startBeat: 9 },
        { text: 'Você não foge', startBeat: 14 },
        { text: 'Amanhã a gente vê', startBeat: 26 },
      ],
    },
  });

  assert.match(result.chunks[1].text, /Eu chego perto/);
  assert.match(result.chunks[1].text, /Você não foge/);
  assert.match(result.chunks[2].text, /Amanhã a gente vê/);
  assert.ok(result.chunks[1].positive_styles.some((style) => /leaves space around the lead vocal/i.test(style)));
  assert.ok(!result.chunks[1].negative_styles.includes('lead vocals'));
});

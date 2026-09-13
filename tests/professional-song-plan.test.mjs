import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfessionalSongPlan, parseStructuredLyrics } from '../packages/app/professional-song-plan.mjs';

const lyrics = `[INTRO — 4 bars, instrumental]

[VERSE 1 — 12 bars]
Nós dois dentro do quarto
Seu lábio no meu

[PRE-CHORUS — 4 bars]
Você some e depois chega perto
Meu quarto tá sempre aberto

[CHORUS — 12 bars]
Mas quando for embora
Jurando que já me esqueceu
Tudo isso é tão eu

[POST-CHORUS — 4 bars, instrumental + vocal ad-libs]

[VERSE 2 — 12 bars]
Se eu tocar, tu se desarma
Você quem vai admitir

[CHORUS 2 — 12 bars]
Mas quando for embora
Tudo isso é tão eu

[INSTRUMENTAL TENSION — 4 bars]

[RAP / BRIDGE — 16 bars, slow and intimate]
Deixo a noite correr sem pressa
Se prepara pra...
(Levar...)

[BEAT CUT — 1 bar silence + 1 bar pickup]

[FINAL CHORUS — 12 bars]
Mas quando for embora
Tudo isso é tão eu

[OUTRO — 6 bars, intimate]
Tão eu...
Todo meu...
Tão eu...`;

test('structured lyrics keep authored order and declared bar counts', () => {
  const parsed = parseStructuredLyrics(lyrics);
  assert.equal(parsed.sections.length, 12);
  assert.deepEqual(parsed.sections.map((section) => section.declaredBars), [4, 12, 4, 12, 4, 12, 12, 4, 16, 1, 12, 6]);
});

test('professional plan uses the authored structure instead of a generic genre template', () => {
  const plan = createProfessionalSongPlan({
    brief: 'Brazilian Portuguese intimate nocturnal pagofunk, Y2K R&B, sensual and natural.',
    lyrics,
    genre: 'rnb',
    bpm: 120,
    durationSeconds: 200,
    singerProfile: { voiceType: 'masculina', language: 'pt-BR', lowMidi: 48, highMidi: 67 },
  });

  assert.equal(plan.professionalBlueprint.authoredStructure, true);
  assert.equal(plan.professionalBlueprint.source, 'authored_lyrics');
  assert.equal(plan.sections.length, 12);
  assert.equal(plan.totalBars, 99);
  assert.equal(plan.durationSeconds, 198);
  assert.equal(plan.sections[0].id, 'intro');
  assert.match(plan.sections[1].id, /^verso_/);
  assert.match(plan.sections[2].id, /^pre_refr_/);
  assert.match(plan.sections[3].id, /^refr_/);
  assert.match(plan.sections[8].id, /^ponte_rap_/);
  assert.match(plan.sections[9].id, /^break_/);
  assert.equal(plan.sections.at(-1).id, 'outro');

  const chorusLines = plan.guideLines.filter((line) => line.sectionId === plan.sections[3].id).map((line) => line.text);
  assert.ok(chorusLines.includes('Jurando que já me esqueceu'));
  assert.ok(plan.guideLines.some((line) => line.text === '(Levar...)'));
});

test('two-bar beat-cut syntax can be declared explicitly without changing other sections', () => {
  const adjusted = lyrics.replace('[BEAT CUT — 1 bar silence + 1 bar pickup]', '[BEAT CUT — 2 bars, silence + pickup]');
  const plan = createProfessionalSongPlan({ brief: 'same song', lyrics: adjusted, genre: 'rnb', bpm: 120, durationSeconds: 200 });
  assert.equal(plan.totalBars, 100);
  assert.equal(plan.durationSeconds, 200);
  assert.equal(plan.sections.find((section) => section.id.startsWith('break_')).bars, 2);
});

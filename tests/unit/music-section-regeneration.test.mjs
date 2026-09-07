import test from 'node:test';
import assert from 'node:assert/strict';
import { latestInpaintableSongTake, resolveSectionRegeneration } from '../../packages/app/music-section-regeneration.mjs';

function projectFixture() {
  return {
    arrangementMap: {
      sections: [
        { id: 'verse-1', kind: 'verse', label: 'Verso', startSeconds: 10, endSeconds: 30 },
        { id: 'chorus-1', kind: 'chorus', label: 'Refrão', startSeconds: 30, endSeconds: null },
        { id: 'verse-2', kind: 'verse', label: 'Verso', startSeconds: 50, endSeconds: 70 },
      ],
    },
    songCreation: {
      takes: [
        { id: 'local', durationSeconds: 90, bpm: 120 },
        {
          id: 'hq-1',
          providerSongId: 'song_abc',
          durationSeconds: 90,
          bpm: 120,
          key: 'A',
          mode: 'minor',
          genre: 'rnb',
          mood: 'noturno',
          brief: 'R&B moderno com synths e baixo quente',
          guideLines: [
            { startBeat: 20, text: 'linha do verso' },
            { startBeat: 60, text: 'abre a janela' },
            { startBeat: 68, text: 'fica mais perto' },
            { startBeat: 104, text: 'segundo verso' },
          ],
        },
      ],
    },
  };
}

test('latest inpaintable take ignores local takes without song id', () => {
  const project = projectFixture();
  project.songCreation.takes.push({ id: 'local-2', durationSeconds: 90 });
  assert.equal(latestInpaintableSongTake(project)?.id, 'hq-1');
});

test('section regeneration infers missing end from next section and keeps section lyrics', () => {
  const result = resolveSectionRegeneration(projectFixture(), 'chorus-1', {
    direction: 'mais energia, synths maiores, sem mudar a identidade',
    negativeStyles: ['heavy dembow', 'EDM drop'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceSongId, 'song_abc');
  assert.equal(result.durationMs, 90000);
  assert.equal(result.section.startMs, 30000);
  assert.equal(result.section.endMs, 50000);
  assert.match(result.section.text, /^\[Refrão\]/);
  assert.match(result.section.text, /abre a janela/);
  assert.match(result.section.text, /fica mais perto/);
  assert.ok(result.section.positiveStyles.includes('mais energia, synths maiores, sem mudar a identidade'));
  assert.deepEqual(result.section.negativeStyles, ['heavy dembow', 'EDM drop']);
  assert.equal(result.section.contextAdherence, 'high');
});

test('manual replacement lyric affects only requested section plan', () => {
  const result = resolveSectionRegeneration(projectFixture(), 'chorus-1', {
    direction: 'mais íntimo',
    lyrics: 'Novo refrão\nSem mexer no resto',
  });
  assert.equal(result.ok, true);
  assert.equal(result.section.text, '[Refrão]\nNovo refrão\nSem mexer no resto');
});

test('regeneration stays unavailable without a provider song id', () => {
  const project = projectFixture();
  project.songCreation.takes = [{ id: 'local', durationSeconds: 90 }];
  assert.deepEqual(resolveSectionRegeneration(project, 'chorus-1'), { ok: false, error: 'inpainting_source_missing' });
});

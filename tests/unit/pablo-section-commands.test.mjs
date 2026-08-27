import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretPabloAudioMessage } from '../../packages/app/pablo-conversation-audio.mjs';
import { applyPabloBeatOperation } from '../../packages/app/pablo-beat-operations.mjs';
import { createProject } from '../../packages/core/src/project.mjs';

test('Pablo parses explicit section timing without guessing from lyrics', () => {
  const seconds = interpretPabloAudioMessage('marca o refrão em 45 segundos', { projectId: 'p1' });
  assert.equal(seconds.kind, 'beat_operation');
  assert.equal(seconds.action, 'mark_section');
  assert.deepEqual(seconds.args, { section: 'refrao', startSeconds: 45, endSeconds: null });

  const clock = interpretPabloAudioMessage('o refrão começa em 1:12', { projectId: 'p1' });
  assert.equal(clock.action, 'mark_section');
  assert.equal(clock.args.startSeconds, 72);

  const range = interpretPabloAudioMessage('marca o refrão de 45 a 61 segundos', { projectId: 'p1' });
  assert.equal(range.action, 'mark_section');
  assert.equal(range.args.startSeconds, 45);
  assert.equal(range.args.endSeconds, 61);
});

test('a lyrics heading alone is not interpreted as a timed section command', () => {
  const result = interpretPabloAudioMessage('[Refrão]\nEu volto aqui', { projectId: 'p1' });
  assert.notEqual(result.action, 'mark_section');
});

test('mark_section persists confirmed timing even before Sampler exists', async () => {
  const project = createProject('Timing manual');
  const result = await applyPabloBeatOperation(project, {
    action: 'mark_section',
    args: { section: 'chorus', startSeconds: 45, endSeconds: 61 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  assert.equal(result.project.arrangementMap.sections[0].kind, 'chorus');
  assert.equal(result.project.arrangementMap.sections[0].timingStatus, 'confirmed');
  assert.equal(result.project.arrangementMap.sections[0].source, 'user_manual');
  assert.equal(result.project.revisions.at(-1).label, 'Refrão marcado na timeline');
});

test('fill before chorus turns confirmed timing into a real-audio render plan without mutating yet', async () => {
  const project = createProject('Virada segura');
  const marked = await applyPabloBeatOperation(project, {
    action: 'mark_section',
    args: { section: 'chorus', startSeconds: 45 },
  });
  const withSampler = {
    ...marked.project,
    sampler: {
      sourceAssetId: 'asset-1',
      grooveTemplate: { ready: false, bpm: 120, stepsPerBar: 16, offsetsBeats: [], accents: [] },
      pads: [{
        id: 'pad-1', sliceId: 'slice-1', sourceAssetId: 'asset-1', label: 'Caixa',
        start: 0, end: 0.2, gain: 1, fadeIn: 0.005, fadeOut: 0.01, playbackRate: 1,
        source: 'audio_onset', category: 'snare', categoryConfidence: 0.9,
      }],
    },
  };

  const result = await applyPabloBeatOperation(withSampler, {
    action: 'fill_before_section',
    args: { section: 'chorus', occurrence: 1, intensity: 0.65 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mutated, false);
  assert.equal(result.requiresAudioRender, true);
  assert.equal(result.timelineRender.kind, 'beat_fill_track');
  assert.equal(result.timelineRender.targetStartSeconds, 45);
  assert.equal(result.timelineRender.endSeconds, 45);
  assert.ok(result.timelineRender.startSeconds < 45);
  assert.equal(result.targetSection.timingStatus, 'confirmed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { latestInpaintableSongTake, regenerationSourceForTake, resolveSectionRegeneration } from '../../packages/app/music-section-regeneration.mjs';
import { NativeMusicSectionRepaintClient, NATIVE_MUSIC_REPAINT_ENDPOINTS } from '../../packages/app/native-music-section-repaint-client.mjs';

function nativeProject() {
  return {
    id: 'local-native',
    arrangementMap: { sections: [
      { id: 'verse-1', kind: 'verse', label: 'Verso', startSeconds: 0, endSeconds: 10 },
      { id: 'chorus-1', kind: 'chorus', label: 'Refrão', startSeconds: 10, endSeconds: 20 },
      { id: 'verse-2', kind: 'verse', label: 'Verso', startSeconds: 20, endSeconds: 30 },
    ] },
    songCreation: { takes: [
      { id: 'legacy', providerSongId: 'song_old', durationSeconds: 30, bpm: 96 },
      {
        id: 'native-1', remoteAssetId: '33333333-3333-4333-8333-333333333333', durationSeconds: 30,
        brief: 'R&B noturno', genre: 'rnb', mood: 'íntimo', bpm: 96, key: 'C', mode: 'minor',
        render: { provider: 'kaggle', model: 'acestep-v15-turbo', modelRevision: 'ca1e85fe9430179831e6bc6be790c332190a3866' },
        guideLines: [{ startBeat: 16, text: 'abre a janela' }, { startBeat: 24, text: 'fica mais perto' }],
      },
    ] },
  };
}

test('latest editable take prefers newest native remote asset and resolves explicit repaint source', () => {
  const project = nativeProject();
  const take = latestInpaintableSongTake(project);
  assert.equal(take.id, 'native-1');
  assert.deepEqual(regenerationSourceForTake(take), {
    type: 'native_asset', sourceAssetId: '33333333-3333-4333-8333-333333333333', sourceSongId: null,
    provider: 'kaggle', model: 'acestep-v15-turbo',
  });
  const plan = resolveSectionRegeneration(project, 'chorus-1', { direction: 'abre mais o refrão' });
  assert.equal(plan.ok, true);
  assert.equal(plan.sourceType, 'native_asset');
  assert.equal(plan.sourceAssetId, '33333333-3333-4333-8333-333333333333');
  assert.equal(plan.sourceSongId, null);
  assert.equal(plan.section.startMs, 10000);
  assert.equal(plan.section.endMs, 20000);
  assert.ok(plan.section.positiveStyles.includes('abre mais o refrão'));
});

test('legacy song-id remains supported when no native source exists', () => {
  const project = nativeProject();
  project.songCreation.takes.pop();
  const plan = resolveSectionRegeneration(project, 'chorus-1');
  assert.equal(plan.ok, true);
  assert.equal(plan.sourceType, 'provider_song_id');
  assert.equal(plan.sourceSongId, 'song_old');
  assert.equal(plan.sourceAssetId, null);
});

function authFixture() {
  return {
    session: { accessToken: 'native-token' },
    async ensureRemoteProject(project) { assert.equal(project.id, 'local-native'); return { ok: true, project: { id: '11111111-1111-4111-8111-111111111111' } }; },
    async ensureSession() { return this.session; },
    clearSession() {}, async loginWithDevice() { return null; },
  };
}

test('native repaint client sends only the selected range and accepts a verified full-mix result', async () => {
  const bytes = new Uint8Array([9,8,7,6,5,4,3,2]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === NATIVE_MUSIC_REPAINT_ENDPOINTS.dispatch) return Response.json({ ok:true, job_id:'22222222-2222-4222-8222-222222222222', job_type:'music_repaint', status:'waiting_kaggle', progress:15 });
    if (String(url).includes('/rest/v1/render_jobs')) return Response.json([{ id:'22222222-2222-4222-8222-222222222222', project_id:'11111111-1111-4111-8111-111111111111', job_type:'music_repaint', status:'completed', progress:100, provider:'kaggle', output_asset_ids:['44444444-4444-4444-8444-444444444444'], proof:{ verified:true, task_type:'repaint', model:'acestep-v15-turbo', model_revision:'ca1e85fe9430179831e6bc6be790c332190a3866', source_asset_id:'33333333-3333-4333-8333-333333333333', source_audio_sha256:'a'.repeat(64), repainting_start:10, repainting_end:20 } }]);
    if (String(url).includes('/rest/v1/audio_assets')) return Response.json([{ id:'44444444-4444-4444-8444-444444444444', project_id:'11111111-1111-4111-8111-111111111111', kind:'full_mix', storage_bucket:'audio-private', storage_path:'user/project/music/repaint.flac', mime_type:'audio/flac', size_bytes:bytes.length, duration_seconds:30, sample_rate:48000, channels:2, sha256:sha, metadata:{ purpose:'section_repaint_reference_mix' } }]);
    if (String(url).includes('/storage/v1/object/authenticated/audio-private/')) return new Response(bytes,{status:200,headers:{'content-type':'audio/flac'}});
    throw new Error(`unexpected ${url}`);
  };
  const client = new NativeMusicSectionRepaintClient({ authAdapter: authFixture(), fetchImpl, pollIntervalMs:0 });
  const result = await client.repaintSection({
    localProject:{id:'local-native'}, sourceAssetId:'33333333-3333-4333-8333-333333333333',
    sourceTake:{ brief:'R&B noturno', genre:'rnb', mood:'íntimo', bpm:96, key:'C', mode:'minor' },
    section:{ id:'chorus-1', label:'Refrão', startMs:10000, endMs:20000, text:'[Refrão]\nabre a janela', positiveStyles:['mais energia'], negativeStyles:['EDM drop'] },
  });
  assert.equal(result.ok,true);
  assert.equal(result.source,'pablovoice_native_music_repaint_v1');
  assert.equal(result.remoteAssetId,'44444444-4444-4444-8444-444444444444');
  assert.equal(result.sha256,sha);
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.operation,'repaint');
  assert.equal(body.source_asset_id,'33333333-3333-4333-8333-333333333333');
  assert.equal(body.section.start_ms,10000);
  assert.equal(body.section.end_ms,20000);
  assert.equal(JSON.stringify(body).includes('native-token'),false);
});

test('native repaint fails closed when terminal proof is not repaint', async () => {
  const fetchImpl = async (url) => {
    if (String(url)===NATIVE_MUSIC_REPAINT_ENDPOINTS.dispatch) return Response.json({ok:true,job_id:'22222222-2222-4222-8222-222222222222',status:'waiting_kaggle'});
    if (String(url).includes('/rest/v1/render_jobs')) return Response.json([{id:'22222222-2222-4222-8222-222222222222',project_id:'11111111-1111-4111-8111-111111111111',job_type:'music_repaint',status:'completed',output_asset_ids:['44444444-4444-4444-8444-444444444444'],proof:{verified:true,task_type:'text2music'}}]);
    throw new Error(`unexpected ${url}`);
  };
  const client=new NativeMusicSectionRepaintClient({authAdapter:authFixture(),fetchImpl,pollIntervalMs:0});
  const result=await client.repaintSection({localProject:{id:'local-native'},sourceAssetId:'33333333-3333-4333-8333-333333333333',section:{id:'chorus-1',startMs:10000,endMs:20000}});
  assert.equal(result.ok,false);
  assert.equal(result.error,'music_repaint_proof_missing');
  assert.equal(result.fallback_allowed,false);
});

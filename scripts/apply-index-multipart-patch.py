from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'patch anchor missing: {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


dispatcher = 'supabase/functions/compute-kaggle-voice-train-v1/index.ts'
replace_once(dispatcher,
"""    const indexPath = `${storageBase}/PabloVoice.index`
    const { data: indexUpload, error: ie } = await admin.storage.from('voice-models-private').createSignedUploadUrl(indexPath)
    if (ie || !indexUpload?.token) throw ie || new Error('signed_index_upload_failed')
""",
"""    const indexPath = `${storageBase}/PabloVoice.index`
    const { data: indexUpload, error: ie } = await admin.storage.from('voice-models-private').createSignedUploadUrl(indexPath)
    if (ie || !indexUpload?.token) throw ie || new Error('signed_index_upload_failed')
    const indexPartUploads: any[] = []
    for (let order = 0; order < 8; order++) {
      const path = `${storageBase}/index-parts/PabloVoice.index.part${String(order).padStart(3, '0')}`
      const { data, error } = await admin.storage.from('voice-models-private').createSignedUploadUrl(path)
      if (error || !data?.token) throw error || new Error('signed_index_part_upload_failed')
      indexPartUploads.push({ order, path, token: data.token })
    }
""")
replace_once(dispatcher,
"outputs: { bucket: 'voice-models-private', parts: partUploads, index: { path: indexPath, token: indexUpload.token } },",
"outputs: { bucket: 'voice-models-private', parts: partUploads, index: { path: indexPath, token: indexUpload.token }, index_parts: indexPartUploads },")

worker = 'supabase/functions/kaggle-voice-train-worker-v1/index.ts'
replace_once(worker,
"""    upload_signed(T['outputs']['bucket'],T['outputs']['index']['path'],T['outputs']['index']['token'],idx)
    post('progress','uploading',94,'Artefatos do modelo candidato persistidos')

    payload={'job_id':T['job_id'],'callback_token':T['callback_token'],'action':'complete','candidate_model_id':T['candidate_model_id'],'applio_commit':commit,'sources':source_proof,'pth_sha256':pth_sha,'index_sha256':idx_sha,'pth_size_bytes':pth.stat().st_size,'index_size_bytes':idx.stat().st_size,'pth_parts':parts,'index_path':T['outputs']['index']['path'],'epochs_requested':requested_epoch,'epochs_completed':target_epoch,'checkpoint_every_epoch':checkpoint_every,'checkpoint_iteration':checkpoint_iteration,'pth_derivation':pth_derivation,'worker_version':'voice-train-v1-budget20-exact-checkpoint-recovery-applio-config-init-tus6m-signed-route','validation':{'asset_id':validation['output']['asset_id'],'sha256':vsha,'size_bytes':flac.stat().st_size,'duration_seconds':vinfo['duration_seconds'],'sample_rate':vinfo['sample_rate'],'channels':vinfo['channels'],'storage_bucket':validation['output']['bucket'],'storage_path':validation['output']['path'],'guide_asset_id':validation['guide_asset_id'],'guide_sha256':validation['guide_sha256'],'region':validation['region']}}
""",
"""    index_parts=[]
    index_path=None
    index_targets=T['outputs'].get('index_parts') or []
    if index_targets:
        index_count=(idx.stat().st_size+part_size-1)//part_size
        if index_count<1 or index_count>len(index_targets): raise RuntimeError('trained index exceeds reserved multipart capacity')
        with open(idx,'rb') as src:
            for order in range(index_count):
                data=src.read(part_size);part=work/f'PabloVoice.index.part{order:03d}';part.write_bytes(data)
                target=index_targets[order]
                upload_signed(T['outputs']['bucket'],target['path'],target['token'],part)
                index_parts.append({'order':order,'path':target['path'],'sha256':sha(part),'size_bytes':part.stat().st_size})
    else:
        upload_signed(T['outputs']['bucket'],T['outputs']['index']['path'],T['outputs']['index']['token'],idx)
        index_path=T['outputs']['index']['path']
    post('progress','uploading',94,f'Artefatos persistidos; index_bytes={idx.stat().st_size}; index_parts={len(index_parts)}')

    payload={'job_id':T['job_id'],'callback_token':T['callback_token'],'action':'complete','candidate_model_id':T['candidate_model_id'],'applio_commit':commit,'sources':source_proof,'pth_sha256':pth_sha,'index_sha256':idx_sha,'pth_size_bytes':pth.stat().st_size,'index_size_bytes':idx.stat().st_size,'pth_parts':parts,'index_parts':index_parts,'index_path':index_path,'epochs_requested':requested_epoch,'epochs_completed':target_epoch,'checkpoint_every_epoch':checkpoint_every,'checkpoint_iteration':checkpoint_iteration,'pth_derivation':pth_derivation,'worker_version':'voice-train-v1-budget20-exact-checkpoint-recovery-applio-config-init-tus6m-signed-route-index-multipart','validation':{'asset_id':validation['output']['asset_id'],'sha256':vsha,'size_bytes':flac.stat().st_size,'duration_seconds':vinfo['duration_seconds'],'sample_rate':vinfo['sample_rate'],'channels':vinfo['channels'],'storage_bucket':validation['output']['bucket'],'storage_path':validation['output']['path'],'guide_asset_id':validation['guide_asset_id'],'guide_sha256':validation['guide_sha256'],'region':validation['region']}}
""")

callback = 'supabase/functions/complete-kaggle-voice-train-v1/index.ts'
replace_once(callback,
"""    const expectedIndexPath = `${outputBase}/PabloVoice.index`
    if (String(body.index_path || '') !== expectedIndexPath) return out({ ok: false, error: 'index_path_mismatch' }, 409)

    const { data: partObjects, error: pe } = await admin.storage.from('voice-models-private').list(`${outputBase}/parts`, { limit: 10 })
""",
"""    const expectedIndexPath = `${outputBase}/PabloVoice.index`
    const indexParts = Array.isArray(body.index_parts) ? body.index_parts : []
    const multipartIndex = indexParts.length > 0
    if (!multipartIndex && String(body.index_path || '') !== expectedIndexPath) return out({ ok: false, error: 'index_path_mismatch' }, 409)
    if (multipartIndex) {
      if (indexParts.length > 8) return out({ ok: false, error: 'invalid_index_part_count' }, 409)
      let indexSum = 0
      for (let order = 0; order < indexParts.length; order++) {
        const part = indexParts[order]
        const expectedPath = `${outputBase}/index-parts/PabloVoice.index.part${String(order).padStart(3, '0')}`
        if (Number(part.order) !== order || String(part.path || '') !== expectedPath || !shaOk(part.sha256) || Number(part.size_bytes || 0) < 1 || Number(part.size_bytes || 0) > 25 * 1024 * 1024) return out({ ok: false, error: 'index_part_contract_mismatch', order }, 409)
        indexSum += Number(part.size_bytes)
      }
      if (indexSum !== indexSize) return out({ ok: false, error: 'index_part_size_sum_mismatch' }, 409)
    }

    const { data: partObjects, error: pe } = await admin.storage.from('voice-models-private').list(`${outputBase}/parts`, { limit: 10 })
""")
replace_once(callback,
"""    const { data: rootObjects, error: re } = await admin.storage.from('voice-models-private').list(outputBase, { limit: 20 })
    if (re) throw re
    const indexObject = (rootObjects || []).find((entry: any) => entry.name === 'PabloVoice.index')
    if (!indexObject || Number(indexObject.metadata?.size || 0) !== indexSize) return out({ ok: false, error: 'index_not_persisted' }, 409)
""",
"""    if (multipartIndex) {
      const { data: indexPartObjects, error: ipe } = await admin.storage.from('voice-models-private').list(`${outputBase}/index-parts`, { limit: 20 })
      if (ipe) throw ipe
      for (const part of indexParts) {
        const name = String(part.path).split('/').pop()
        const object = (indexPartObjects || []).find((entry: any) => entry.name === name)
        if (!object || Number(object.metadata?.size || 0) !== Number(part.size_bytes)) return out({ ok: false, error: 'index_part_not_persisted', path: part.path }, 409)
      }
    } else {
      const { data: rootObjects, error: re } = await admin.storage.from('voice-models-private').list(outputBase, { limit: 20 })
      if (re) throw re
      const indexObject = (rootObjects || []).find((entry: any) => entry.name === 'PabloVoice.index')
      if (!indexObject || Number(indexObject.metadata?.size || 0) !== indexSize) return out({ ok: false, error: 'index_not_persisted' }, 409)
    }
""")
replace_once(callback,
"client: 'voice-train-v1', storage_mode: 'multipart', pth_parts: parts, pth_size: pthSize, index_size: indexSize,",
"client: 'voice-train-v1', storage_mode: multipartIndex ? 'multipart-pth-index' : 'multipart', pth_parts: parts, pth_size: pthSize, index_parts: indexParts, index_size: indexSize,")
replace_once(callback,
"pth_storage_path: null, index_storage_path: expectedIndexPath, pth_sha256: pthSha, index_sha256: indexSha,",
"pth_storage_path: null, index_storage_path: multipartIndex ? null : expectedIndexPath, pth_sha256: pthSha, index_sha256: indexSha,")

contract = Path('tests/contracts/voice-model-candidate-training.test.mjs')
text = contract.read_text()
addition = r'''

test('large RVC indexes are persisted as bounded multipart objects without changing the training recipe', () => {
  assert.match(dispatcher, /indexPartUploads/)
  assert.match(dispatcher, /index-parts\/PabloVoice\.index\.part/)
  assert.match(dispatcher, /index_parts: indexPartUploads/)
  assert.match(worker, /index_targets=T\['outputs'\]\.get\('index_parts'\) or \[\]/)
  assert.match(worker, /trained index exceeds reserved multipart capacity/)
  assert.match(worker, /'index_parts':index_parts/)
  assert.match(callback, /multipart-pth-index/)
  assert.match(callback, /index_part_size_sum_mismatch/)
  assert.match(callback, /index_part_not_persisted/)
  assert.match(callback, /index_storage_path: multipartIndex \? null : expectedIndexPath/)
  assert.match(dispatcher, /total_epoch: 200/)
  assert.match(worker, /RUNTIME_EPOCH_BUDGET=20/)
  assert.match(callback, /IDENTITY_THRESHOLD = 0\.8/)
})
'''
if 'large RVC indexes are persisted as bounded multipart objects' not in text:
    contract.write_text(text + addition)

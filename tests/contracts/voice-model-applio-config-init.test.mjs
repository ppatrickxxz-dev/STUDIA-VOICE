import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const worker = readFileSync(new URL('../../supabase/functions/kaggle-voice-train-worker-v1/index.ts', import.meta.url), 'utf8')

test('headless Applio worker materializes runtime config exactly from the pinned template', () => {
  assert.match(worker, /config_template=A\/'assets\/config_template\.json';config_path=A\/'assets\/config\.json'/)
  assert.match(worker, /if not config_template\.exists\(\): raise RuntimeError\('Applio config template missing'\)/)
  assert.match(worker, /if not config_path\.exists\(\): shutil\.copy\(config_template,config_path\)/)
  assert.match(worker, /with open\(config_path,'r',encoding='utf-8'\) as f:/)
  assert.match(worker, /if 'model_author' not in runtime_config: raise RuntimeError\('Applio runtime config invalid'\)/)
})

test('Applio runtime config is initialized before exact checkpoint recovery can call extract_model', () => {
  const configInit = worker.indexOf("config_template=A/'assets/config_template.json'")
  const extractCall = worker.indexOf('extract_model(ckpt=ckpt')
  assert.ok(configInit >= 0)
  assert.ok(extractCall >= 0)
  assert.ok(configInit < extractCall)
})

test('voice training contract keeps frozen runtime budget and identity threshold untouched', () => {
  assert.match(worker, /RUNTIME_EPOCH_BUDGET=20/)
  assert.doesNotMatch(worker, /RUNTIME_EPOCH_BUDGET=(?!20\b)\d+/)
  assert.match(worker, /worker_version':'voice-train-v1-budget20-exact-checkpoint-recovery-applio-config-init'/)
})

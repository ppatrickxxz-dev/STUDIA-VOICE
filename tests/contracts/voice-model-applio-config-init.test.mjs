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

test('Applio runtime config is initialized before exact checkpoint recovery is invoked', () => {
  const configInit = worker.indexOf("config_template=A/'assets/config_template.json'")
  const recoveryCall = worker.lastIndexOf('recover_exact_final_inference_model(exp,model_name,target_epoch')
  assert.ok(configInit >= 0)
  assert.ok(recoveryCall >= 0)
  assert.ok(configInit < recoveryCall)
})

test('voice training contract keeps the frozen runtime budget and config-init lineage untouched', () => {
  assert.match(worker, /RUNTIME_EPOCH_BUDGET=100/)
  assert.doesNotMatch(worker, /RUNTIME_EPOCH_BUDGET=(?!100\b)\d+/)
  assert.match(worker, /worker_version':'voice-train-v1-budget100-exact-checkpoint-recovery-applio-config-init(?:-[a-z0-9]+)*'/)
})

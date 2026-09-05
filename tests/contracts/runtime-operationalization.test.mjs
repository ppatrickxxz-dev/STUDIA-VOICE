import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../../config/runtime-functions.json', import.meta.url), 'utf8'))

function filesUnder(path) {
  const out = []
  const walk = current => {
    for (const name of readdirSync(current)) {
      const full = join(current, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(path)
  return out
}

test('runtime source of truth forbids recycled slots and remote self-import wrappers', () => {
  assert.equal(manifest.policy.repository_is_source_of_truth, true)
  assert.equal(manifest.policy.forbid_remote_self_import_wrappers, true)
  assert.equal(manifest.policy.forbid_recycled_function_slots, true)
  assert.equal(manifest.policy.forbid_new_versioned_app_aliases, true)
  assert.equal(manifest.policy.forbid_new_one_shot_functions, true)
})

test('candidate voice workflow uses canonical function slugs', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/voice-model-candidate-train.yml', import.meta.url), 'utf8')
  assert.match(workflow, /TRAIN_DISPATCH_FUNCTION:\s*compute-kaggle-voice-train-v1/)
  assert.match(workflow, /TRAIN_PROMOTER_FUNCTION:\s*promote-voice-candidate-v1/)
  assert.doesNotMatch(workflow, /TRAIN_DISPATCH_FUNCTION:\s*app-v\d+/)
  assert.doesNotMatch(workflow, /TRAIN_PROMOTER_FUNCTION:\s*app-v\d+/)
  assert.doesNotMatch(workflow, /legacy UI[\s\S]{0,120}recycled/i)
})

test('versioned source tree never imports PabloVoice runtime from raw GitHub', () => {
  const base = new URL('../../supabase/functions/', import.meta.url)
  const files = filesUnder(base.pathname).filter(path => /\.(?:ts|js|mjs|json)$/.test(path))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /raw\.githubusercontent\.com\/ppatrickxxz-dev\/STUDIA-VOICE/i, file)
  }
})

test('retired naming patterns cannot be introduced as versioned Edge Functions', () => {
  const entries = readdirSync(new URL('../../supabase/functions/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  for (const slug of entries) {
    assert.doesNotMatch(slug, /(?:^|-)once(?:-|$)/i, slug)
    assert.doesNotMatch(slug, /^app-v\d+(?:-|$)/i, slug)
    assert.doesNotMatch(slug, /^repair-/i, slug)
    assert.doesNotMatch(slug, /^diagnose-/i, slug)
    assert.doesNotMatch(slug, /^test-.*-once$/i, slug)
  }
})

test('manifest keeps canonical and retired functions disjoint', () => {
  const canonical = new Set(manifest.canonical)
  const retired = new Set(manifest.retired)
  for (const slug of retired) assert.equal(canonical.has(slug), false, slug)
  for (const slug of manifest.legacy_aliases_to_remove_after_canonical_cutover) {
    assert.equal(canonical.has(slug), false, slug)
  }
})

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../../.github/workflows/b09-acoustic-evidence.yml', import.meta.url), 'utf8');

test('B09 live acoustic workflow is bound to the frozen source and retained standalone stems', () => {
  for (const value of [
    '81a17053-5789-4cf1-9ba5-21c665f3b8cb',
    'ff57cb304fbe72783b78ab5f43137cd3daba2736e76135d86beb0e1f8f0e6e2d',
    '1180440960ee1e0288509960763aa1e646ca5689c1d657de914617bbb4c95708',
    'db2c5ee693934133a40ab9b561bd601377c50c72bc6c3c863db30e294c2625d3',
    'benchmarks/validate_b09.py',
  ]) assert.match(workflow, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('B09 measurement does not depend on the frozen provider-input vocal or fabricate promotion', () => {
  assert.doesNotMatch(workflow, /85b6341bac253f85a48506400baed3dd2bbf212ac172af6d0fa8e47d35642b95/);
  assert.doesNotMatch(workflow, /B09_STANDALONE_STEMS_PASSED/);
  assert.match(workflow, /promotion_state == \"not_promoted\"/);
  assert.match(workflow, /proof\.verified == true/);
});

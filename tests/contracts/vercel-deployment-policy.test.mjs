import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('Vercel deploys production from main without spending quota on preview branches', () => {
  const policy = config.git?.deploymentEnabled;

  assert.equal(policy?.main, true);
  assert.equal(policy?.['*'], false);
  assert.deepEqual(Object.keys(policy).sort(), ['*', 'main']);
});

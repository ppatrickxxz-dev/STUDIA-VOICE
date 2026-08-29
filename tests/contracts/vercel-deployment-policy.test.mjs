import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('Vercel automatic Git deployments are disabled so only deliberate release deploys consume quota', () => {
  assert.equal(config.git?.deploymentEnabled, false);
});

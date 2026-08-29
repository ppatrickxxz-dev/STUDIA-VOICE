import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

test('Vercel Git deployments stay disabled so release deployment is deliberate', () => {
  assert.equal(config.git?.deploymentEnabled, false);
});

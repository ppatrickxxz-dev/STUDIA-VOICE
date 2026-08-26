import test from 'node:test';
import assert from 'node:assert/strict';
import { healthPayload } from '../../services/api/health.mjs';

test('health contract is honest about unavailable cloud capabilities', () => {
  const health = healthPayload('abc123');
  assert.equal(health.ok, true);
  assert.equal(health.commit, 'abc123');
  assert.equal(health.capabilities.projects, 'local');
  assert.equal(health.capabilities.ai, 'not-configured');
  assert.equal(health.capabilities.stems, 'not-configured');
});


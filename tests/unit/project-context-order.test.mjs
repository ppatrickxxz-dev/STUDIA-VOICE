import assert from 'node:assert/strict';
import test from 'node:test';
import { sortProjectsByContext } from '../../packages/app/storage.mjs';

const projects = [
  { id: 'newer', updatedAt: 200 },
  { id: 'opened', updatedAt: 100 },
  { id: 'oldest', updatedAt: 50 },
];

test('explicitly opened project is first even when another project is newer', () => {
  const sorted = sortProjectsByContext(projects, 'opened');
  assert.deepEqual(sorted.map((project) => project.id), ['opened', 'newer', 'oldest']);
});

test('without an active session project ordering remains updatedAt descending', () => {
  const sorted = sortProjectsByContext(projects, null);
  assert.deepEqual(sorted.map((project) => project.id), ['newer', 'opened', 'oldest']);
});

test('unknown active project id does not disturb updatedAt ordering', () => {
  const sorted = sortProjectsByContext(projects, 'missing');
  assert.deepEqual(sorted.map((project) => project.id), ['newer', 'opened', 'oldest']);
});

test('sorting does not mutate the caller project array', () => {
  const original = projects.map((project) => project.id);
  sortProjectsByContext(projects, 'opened');
  assert.deepEqual(projects.map((project) => project.id), original);
});

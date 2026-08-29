import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/release.yml', import.meta.url);
const packageUrl = new URL('../../package.json', import.meta.url);

async function load() {
  const [workflow, packageText] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(packageUrl, 'utf8'),
  ]);
  return { workflow, pkg: JSON.parse(packageText) };
}

test('manual release tag must exactly match the package version', async () => {
  const { workflow, pkg } = await load();
  assert.match(workflow, /Validate release tag intent/);
  assert.match(workflow, /EXPECTED_TAG="v\$\{PACKAGE_VERSION\}"/);
  assert.match(workflow, /RELEASE_TAG_MISMATCH/);
  assert.equal(`v${pkg.version}`, 'v2.4.0-rc.1');
});

test('release tag is created only after signed artifacts are uploaded', async () => {
  const { workflow } = await load();
  const uploadIndex = workflow.indexOf('- name: Upload stable signed artifacts');
  const tagIndex = workflow.indexOf('- name: Create or verify release tag');
  assert.ok(uploadIndex >= 0);
  assert.ok(tagIndex > uploadIndex);
});

test('existing release tags fail closed on SHA drift and are never force-pushed', async () => {
  const { workflow } = await load();
  assert.match(workflow, /TAG_SHA="\$\(git rev-parse "\$RELEASE_TAG\^\{commit\}"\)"/);
  assert.match(workflow, /RELEASE_TAG_DRIFT/);
  assert.match(workflow, /\[ "\$TAG_SHA" != "\$GITHUB_SHA" \]/);
  assert.doesNotMatch(workflow, /git push[^\n]*(?:--force|-f\b)/);
});

test('draft release is idempotent but a published release cannot be overwritten', async () => {
  const { workflow } = await load();
  assert.match(workflow, /gh release view "\$RELEASE_TAG" --json isDraft/);
  assert.match(workflow, /RELEASE_ALREADY_PUBLISHED/);
  assert.match(workflow, /gh release upload "\$RELEASE_TAG" "\$\{RELEASE_FILES\[@\]\}" --clobber/);
  assert.match(workflow, /--draft --verify-tag --generate-notes/);
});

test('signed release runs are serialized instead of cancelling an in-flight signing run', async () => {
  const { workflow } = await load();
  assert.match(workflow, /group: pablovoice-signed-release-\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
});

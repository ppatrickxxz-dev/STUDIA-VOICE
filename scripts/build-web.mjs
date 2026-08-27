import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'apps/web/dist');
const packages = resolve(root, 'packages');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(packages, 'app'), out, { recursive: true });
for (const name of ['core', 'audio', 'songwriting', 'providers']) {
  await cp(resolve(packages, name), resolve(out, name), { recursive: true });
}
await writeFile(resolve(out, 'build.json'), `${JSON.stringify({
  product: 'PabloVoice',
  version: process.env.PV_VERSION || '2.4.0-rc.1',
  commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');
console.log(`PabloVoice Web built at ${out}`);

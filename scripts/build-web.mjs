import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'apps/web/dist');
const packages = resolve(root, 'packages');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(packages, 'app'), out, { recursive: true });
for (const name of ['core', 'audio', 'songwriting']) {
  await cp(resolve(packages, name), resolve(out, name), { recursive: true });
}
await cp(resolve(packages, 'providers'), resolve(out, 'providers'), { recursive: true });
await cp(resolve(packages, 'music-intelligence'), resolve(out, 'music-intelligence'), { recursive: true });
await cp(resolve(packages, 'site-vivo'), resolve(out, 'site'), { recursive: true });

// packages/app is flattened into the Web root. Rewrite only root app imports
// that point to sibling packages, then fail the build if a relative import is unresolved.
for (const name of await readdir(out)) {
  if (!name.endsWith('.mjs') && !name.endsWith('.js')) continue;
  const file = resolve(out, name);
  if (!(await stat(file)).isFile()) continue;
  const original = await readFile(file, 'utf8');
  const rewritten = original.replace(
    /(['"]|\()\.\.\/(core|audio|songwriting|providers|music-intelligence)\//g,
    (_match, prefix, pkg) => `${prefix}./${pkg}/`,
  );
  if (rewritten !== original) await writeFile(file, rewritten, 'utf8');
}

await assertBuiltRelativeImportsResolve(out);

await writeFile(resolve(out, 'build.json'), `${JSON.stringify({
  product: 'PabloVoice',
  version: process.env.PV_VERSION || '2.4.0',
  commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');
console.log(`PabloVoice Web built at ${out}`);

async function assertBuiltRelativeImportsResolve(directory) {
  const files = await collectModules(directory);
  const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      try {
        if (!(await stat(target)).isFile()) missing.push(`${file}: ${specifier}`);
      } catch {
        missing.push(`${file}: ${specifier}`);
      }
    }
  }
  if (missing.length) throw new Error(`WEB_BUILD_UNRESOLVED_IMPORTS\n${missing.join('\n')}`);
}

async function collectModules(directory) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) modules.push(...await collectModules(path));
    else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.js'))) modules.push(path);
  }
  return modules;
}

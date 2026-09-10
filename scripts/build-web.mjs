import { cp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

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

// packages/app contains historical modules kept in Git for release evidence and rollback,
// but shipping every retired root module makes the mobile Web bundle slower. Build the
// runtime closure from the real HTML module entrypoints and remove only unreachable
// top-level JS/MJS files. Imported package modules and workers remain untouched.
await pruneUnreachableRootModules(out);
await assertBuiltRelativeImportsResolve(out);

await writeFile(resolve(out, 'build.json'), `${JSON.stringify({
  product: 'PabloVoice',
  version: process.env.PV_VERSION || '2.4.0',
  commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');
console.log(`PabloVoice Web built at ${out}`);

async function pruneUnreachableRootModules(directory) {
  const html = await readFile(resolve(directory, 'index.html'), 'utf8');
  const entrypoints = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\.\/([^"']+)["'][^>]*>/gi)]
    .map((match) => resolve(directory, match[1]));
  const serviceWorker = resolve(directory, 'service-worker.js');
  try { if ((await stat(serviceWorker)).isFile()) entrypoints.push(serviceWorker); } catch { /* optional */ }

  const reachable = new Set();
  const pending = [...entrypoints];
  while (pending.length) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    let source;
    try { source = await readFile(file, 'utf8'); } catch { continue; }
    reachable.add(file);
    for (const specifier of relativeModuleSpecifiers(source)) {
      const target = resolve(dirname(file), specifier);
      try {
        if ((await stat(target)).isFile() && !reachable.has(target)) pending.push(target);
      } catch { /* unresolved imports are reported by the build assertion */ }
    }
  }

  let removedBytes = 0;
  const removed = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.mjs') && !name.endsWith('.js')) continue;
    const file = resolve(directory, name);
    if (reachable.has(file)) continue;
    const info = await stat(file);
    if (!info.isFile()) continue;
    removedBytes += info.size;
    removed.push(name);
    await unlink(file);
  }
  console.log(`Pruned ${removed.length} unreachable root modules (${removedBytes} bytes): ${removed.join(', ') || 'none'}`);
}

function relativeModuleSpecifiers(source) {
  const values = new Set();
  const staticPattern = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) if (match[1]?.startsWith('.')) values.add(match[1]);
  }
  return values;
}

async function assertBuiltRelativeImportsResolve(directory) {
  const files = await collectModules(directory);
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of relativeModuleSpecifiers(source)) {
      const target = resolve(dirname(file), specifier);
      try {
        if (!(await stat(target)).isFile()) missing.push(`${relative(directory, file)}: ${specifier}`);
      } catch {
        missing.push(`${relative(directory, file)}: ${specifier}`);
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

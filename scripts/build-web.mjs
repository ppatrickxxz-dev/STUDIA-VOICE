import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'apps/web/dist');
const packages = resolve(root, 'packages');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(packages, 'app'), out, { recursive: true });

// Superseded implementations and visual themes stay in source history for safe
// rollback, but they are not part of the shipped Studia Voice product surface.
// Active runtime modules must stay present so build validation fails closed on drift.
for (const obsolete of [
  'pablovoice-vnext-ui.mjs',
  'pablovoice-companion-reactor.mjs',
  'pablovoice-intimate-ui.css',
  'pablo-life-ui.css',
  'pablovoice-product-overrides.css',
  'pablovoice-product-ui.css',
]) {
  await rm(resolve(out, obsolete), { force: true });
}

for (const name of ['core', 'audio', 'songwriting']) {
  await cp(resolve(packages, name), resolve(out, name), { recursive: true });
}
await cp(resolve(packages, 'providers'), resolve(out, 'providers'), { recursive: true });
await cp(resolve(packages, 'music-intelligence'), resolve(out, 'music-intelligence'), { recursive: true });
await cp(resolve(packages, 'site-vivo'), resolve(out, 'site'), { recursive: true });

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

await compactModuleLayout(out);
await compactCssLayout(out);
await compactHtmlLayout(out);
await compactStructuredAssets(out);
await assertBuiltRelativeImportsResolve(out);

await writeFile(resolve(out, 'build.json'), `${JSON.stringify({
  product: 'PabloVoice',
  version: process.env.PV_VERSION || '2.4.0',
  commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString(),
})}\n`, 'utf8');
console.log(`PabloVoice Web built at ${out}`);

async function compactModuleLayout(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compactModuleLayout(path);
      continue;
    }
    if (!entry.isFile() || (!entry.name.endsWith('.mjs') && !entry.name.endsWith('.js'))) continue;
    const source = await readFile(path, 'utf8');
    const compacted = source
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (!trimmed.startsWith('//')) return true;
        return /^\/\/[#@]\s*(sourceURL|sourceMappingURL)=/.test(trimmed);
      })
      .join('\n') + '\n';
    if (compacted !== source) await writeFile(path, compacted, 'utf8');
  }
}

async function compactCssLayout(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compactCssLayout(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
    const source = await readFile(path, 'utf8');
    const compacted = source
      .replace(/\r/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/([;{}])\n/g, '$1');
    if (compacted !== source) await writeFile(path, compacted, 'utf8');
  }
}

async function compactHtmlLayout(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compactHtmlLayout(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const source = await readFile(path, 'utf8');
    const compacted = source
      .replace(/\r/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n');
    if (compacted !== source) await writeFile(path, compacted, 'utf8');
  }
}

async function compactStructuredAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compactStructuredAssets(path);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.json') || entry.name.endsWith('.webmanifest')) {
      const source = await readFile(path, 'utf8');
      try {
        const compacted = `${JSON.stringify(JSON.parse(source))}\n`;
        if (compacted !== source) await writeFile(path, compacted, 'utf8');
      } catch {
        // Non-JSON text with one of these suffixes remains untouched.
      }
      continue;
    }
    if (!entry.name.endsWith('.svg')) continue;
    const source = await readFile(path, 'utf8');
    const compacted = source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/>\s+</g, '><')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim() + '\n';
    if (compacted !== source) await writeFile(path, compacted, 'utf8');
  }
}

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

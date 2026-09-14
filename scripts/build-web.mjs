import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'apps/web/dist');
const packages = resolve(root, 'packages');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(packages, 'app'), out, { recursive: true });

// Keep superseded implementations in source history for auditability, but never
// ship dead duplicate product paths. Active compatibility modules remain shipped
// and the unresolved-import gate below protects this list from unsafe pruning.
for (const obsolete of [
  'pablovoice-vnext-ui.mjs',
  'pablovoice-companion-reactor.mjs',
  'creator-online-language.mjs',
]) {
  await rm(resolve(out, obsolete), { force: true });
}

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

// Production-only compaction: source remains readable in Git. CSS keeps the same
// selectors/tokens; HTML preserves raw text blocks; JSON/webmanifest is parsed and
// serialized so only formatting bytes are removed.
await compactCssLayout(out);
await compactStaticMarkup(out);
await assertBuiltRelativeImportsResolve(out);

await writeFile(resolve(out, 'build.json'), JSON.stringify({
  product: 'PabloVoice',
  version: process.env.PV_VERSION || '2.4.0',
  commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString(),
}), 'utf8');
console.log(`PabloVoice Web built at ${out}`);

async function compactCssLayout(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compactCssLayout(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
    const source = await readFile(path, 'utf8');
    const compacted = minifyCssLayout(source);
    if (compacted !== source) await writeFile(path, compacted, 'utf8');
  }
}

function minifyCssLayout(source) {
  let output = '';
  let quote = '';
  let escaped = false;
  let comment = false;
  let pendingSpace = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || '';

    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 1;
        pendingSpace = true;
      }
      continue;
    }

    if (quote) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }

    if (char === '/' && next === '*') {
      comment = true;
      index += 1;
      pendingSpace = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (pendingSpace && output && !/[\s{;,>+~]$/.test(output)) output += ' ';
      pendingSpace = false;
      quote = char;
      output += char;
      continue;
    }

    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }

    const punctuation = /[{};,>+~]/.test(char);
    if (pendingSpace && output && !punctuation && !/[{;,>+~]$/.test(output)) output += ' ';
    pendingSpace = false;
    if (punctuation && output.endsWith(' ')) output = output.slice(0, -1);
    output += char;
  }

  return output.trim().replace(/;}/g, '}');
}

async function compactStaticMarkup(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await compactStaticMarkup(path);
      continue;
    }
    if (!entry.isFile()) continue;

    if (entry.name.endsWith('.html')) {
      const source = await readFile(path, 'utf8');
      const compacted = minifyHtmlLayout(source);
      if (compacted !== source) await writeFile(path, compacted, 'utf8');
      continue;
    }

    if (entry.name.endsWith('.json') || entry.name.endsWith('.webmanifest')) {
      const source = await readFile(path, 'utf8');
      try {
        const compacted = JSON.stringify(JSON.parse(source));
        if (compacted !== source) await writeFile(path, compacted, 'utf8');
      } catch {
        // Fail-safe: malformed/non-JSON files are left untouched and the existing
        // build/runtime gates remain responsible for rejecting them.
      }
    }
  }
}

function minifyHtmlLayout(source) {
  const protectedBlocks = [];
  const protectedSource = source.replace(/<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi, (block) => {
    const token = `__PV_RAW_HTML_${protectedBlocks.length}__`;
    protectedBlocks.push(block);
    return token;
  });

  let compacted = protectedSource
    .replace(/<!--(?!\[if)[\s\S]*?-->/gi, '')
    .replace(/>\s+</g, '><')
    .trim();

  protectedBlocks.forEach((block, index) => {
    compacted = compacted.replace(`__PV_RAW_HTML_${index}__`, block);
  });
  return compacted;
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

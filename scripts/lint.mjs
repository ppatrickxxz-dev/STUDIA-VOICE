import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const roots = ['packages', 'scripts', 'services', 'tests', 'cloudflare'];
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(path);
  }
}
for (const name of roots) await walk(resolve(root, name));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax gate passed for ${files.length} JavaScript files.`);

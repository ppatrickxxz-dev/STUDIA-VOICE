import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../apps/web/dist');
const required = [
  'index.html', 'preboot.mjs', 'app.js', 'styles.css', 'service-worker.js', 'manifest.webmanifest',
  'core/src/project.mjs', 'audio/src/presets.mjs', 'analysis/src/analyzer.mjs', 'songwriting/src/analyzer.mjs',
];
for (const path of required) {
  await access(resolve(root, path));
  if ((await stat(resolve(root, path))).size === 0) throw new Error(`${path} is empty`);
}
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const preboot = await readFile(resolve(root, 'preboot.mjs'), 'utf8');
const app = await readFile(resolve(root, 'app.js'), 'utf8');
if (!html.includes('Você tá no estúdio')) throw new Error('Approved home copy is missing');
if (!html.includes('./preboot.mjs')) throw new Error('Resilient preboot entrypoint is missing');
if (!preboot.includes("await import('./app.js')")) throw new Error('Preboot must load the canonical app module');
if (/https:\/\/[^'"\s]+vercel\.app/i.test(html + preboot + app)) throw new Error('Remote Vercel boot dependency detected');
console.log('Web build contract passed.');

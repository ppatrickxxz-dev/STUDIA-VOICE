import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../apps/web/dist');
const required = [
  'index.html', 'preboot.mjs', 'app.js', 'styles.css', 'service-worker.js', 'manifest.webmanifest',
  'core/src/project.mjs', 'audio/src/presets.mjs', 'songwriting/src/analyzer.mjs',
  'audio/src/automation/region-restoration.mjs', 'audio/src/analyzers/vocal-restoration.mjs',
  'site/index.html', 'site/styles.css', 'site/site.js',
  'site/assets/hero_ui.webp', 'site/assets/companions_board.webp', 'site/assets/pablo_fullbody.webp',
];
for (const path of required) {
  await access(resolve(root, path));
  if ((await stat(resolve(root, path))).size === 0) throw new Error(`${path} is empty`);
}
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const preboot = await readFile(resolve(root, 'preboot.mjs'), 'utf8');
const app = await readFile(resolve(root, 'app.js'), 'utf8');
const site = await readFile(resolve(root, 'site/index.html'), 'utf8');
if (!html.includes('Você tá no estúdio')) throw new Error('Approved home copy is missing');
if (!html.includes('./preboot.mjs')) throw new Error('Resilient preboot entrypoint is missing');
if (!preboot.includes("await import('./app.js')")) throw new Error('Preboot must load the canonical app module');
if (/https:\/\/[^'"\s]+vercel\.app/i.test(html + preboot + app)) throw new Error('Remote Vercel boot dependency detected');
if (!site.includes('Você tá no estúdio')) throw new Error('Site Vivo approved hero copy is missing');
if (!site.includes('./styles.css') || !site.includes('./site.js')) throw new Error('Site Vivo external CSS/JS entrypoints are missing');
if (/<style(?:\s|>)/i.test(site) || /<script(?![^>]*\bsrc=)[^>]*>/i.test(site) || /\sstyle=/i.test(site)) {
  throw new Error('Site Vivo must remain compatible with the production CSP (no inline CSS/JS)');
}
console.log('Web build contract passed.');

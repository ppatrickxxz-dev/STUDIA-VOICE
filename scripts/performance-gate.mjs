import { readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../apps/web/dist');
const entries = [];
async function walk(dir) {
  for (const name of await readdir(dir)) {
    const path = resolve(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) await walk(path);
    else entries.push({ path: relative(root, path), bytes: info.size });
  }
}
await walk(root);
const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
const limits = { totalBytes: 1_500_000, appJsBytes: 300_000, cssBytes: 180_000 };
const appJsBytes = entries.find((entry) => entry.path === 'app.js')?.bytes || 0;
const cssBytes = entries.find((entry) => entry.path === 'styles.css')?.bytes || 0;
const report = { generatedAt: new Date().toISOString(), totalBytes, appJsBytes, cssBytes, limits, passed: totalBytes <= limits.totalBytes && appJsBytes <= limits.appJsBytes && cssBytes <= limits.cssBytes };
await writeFile(resolve(root, 'performance.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) throw new Error(`Web bundle performance budget exceeded: ${JSON.stringify(report)}`);
console.log(`PERFORMANCE_BUNDLE_GATE_PASSED total=${totalBytes} app=${appJsBytes} css=${cssBytes}`);


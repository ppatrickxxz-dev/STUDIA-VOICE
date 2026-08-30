import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CREDENTIAL_PATTERN = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|service_role[^A-Za-z0-9]|AKIA[0-9A-Z]{16})/;
export const WEBVIEW_PATTERN = /usesCleartextTraffic="true"|setAllowFileAccess\(true\)|MIXED_CONTENT_ALWAYS_ALLOW/;

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CREDENTIAL_ROOTS = ['packages', 'apps', 'services', 'cloudflare', 'scripts', 'tests', 'docs', '.github'];
const WEBVIEW_ROOTS = ['apps/android', 'packages'];

export function findPatternLines(text, pattern) {
  const findings = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (pattern.test(line)) findings.push({ line: index + 1, text: line });
    pattern.lastIndex = 0;
  }
  return findings;
}

export function shouldSkipCredentialPath(path) {
  const normalized = String(path).split(sep).join('/');
  return normalized === 'docs/inventory.md'
    || normalized === 'scripts/security-gate.sh'
    || normalized === 'scripts/security-static-scan.mjs'
    || normalized.endsWith('.test.mjs');
}

async function scanRoots(roots, pattern, { skip = () => false } = {}) {
  const findings = [];
  for (const root of roots) {
    const absoluteRoot = resolve(REPO_ROOT, root);
    for await (const file of walkFiles(absoluteRoot)) {
      const repoPath = relative(REPO_ROOT, file).split(sep).join('/');
      if (skip(repoPath)) continue;
      const content = await readFile(file);
      if (content.includes(0)) continue;
      const text = content.toString('utf8');
      for (const finding of findPatternLines(text, pattern)) findings.push({ path: repoPath, ...finding });
    }
  }
  return findings;
}

async function* walkFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`SECURITY_GATE_FAILED: scan root missing: ${relative(REPO_ROOT, root)}`);
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walkFiles(path);
    else if (entry.isFile()) yield path;
  }
}

function report(label, findings) {
  if (!findings.length) return;
  for (const finding of findings) console.error(`${finding.path}:${finding.line}:${finding.text}`);
  console.error(`SECURITY_GATE_FAILED: ${label}`);
}

export async function runSecurityStaticScan() {
  const credentialFindings = await scanRoots(CREDENTIAL_ROOTS, CREDENTIAL_PATTERN, { skip: shouldSkipCredentialPath });
  if (credentialFindings.length) {
    report('credential-shaped content found', credentialFindings);
    return 1;
  }

  const webviewFindings = await scanRoots(WEBVIEW_ROOTS, WEBVIEW_PATTERN);
  if (webviewFindings.length) {
    report('unsafe WebView configuration found', webviewFindings);
    return 1;
  }

  console.log('SECURITY_STATIC_GATE_PASSED');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSecurityStaticScan()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 2;
    });
}

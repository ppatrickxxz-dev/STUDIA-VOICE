#!/usr/bin/env bash
set -euo pipefail

scan_roots=(packages apps services api scripts tests docs .github)
if rg -n --hidden --glob '!docs/inventory.md' --glob '!*.test.mjs' --glob '!scripts/security-gate.sh' \
  '(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|service_role[^A-Za-z0-9]|AKIA[0-9A-Z]{16})' \
  "${scan_roots[@]}"; then
  echo 'SECURITY_GATE_FAILED: credential-shaped content found' >&2
  exit 1
fi

if rg -n 'usesCleartextTraffic="true"|setAllowFileAccess\(true\)|MIXED_CONTENT_ALWAYS_ALLOW' apps/android packages; then
  echo 'SECURITY_GATE_FAILED: unsafe WebView configuration found' >&2
  exit 1
fi

echo 'SECURITY_STATIC_GATE_PASSED'

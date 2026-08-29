#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?usage: android-validate-signed-aab.sh path/to/app-release.apk path/to/app-release.aab}"
aab_path="${2:?usage: android-validate-signed-aab.sh path/to/app-release.apk path/to/app-release.aab}"

for file in "$apk_path" "$aab_path"; do
  test -f "$file" || { echo "ANDROID_RELEASE_ARTIFACT_MISSING: $file" >&2; exit 1; }
done

build_tools="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/build-tools/35.0.0"
apksigner="$build_tools/apksigner"
test -x "$apksigner" || { echo "ANDROID_APKSIGNER_MISSING: $apksigner" >&2; exit 1; }

jarsigner_evidence="${aab_path}.jarsigner.txt"
signer_evidence="${aab_path}.signer-sha256.txt"

# AABs use JAR signing. Do not use jarsigner -strict here: -strict promotes
# certificate trust-chain warnings (including an intentionally self-signed
# release certificate) to a non-zero exit even when the JAR signature itself
# is cryptographically valid.
jarsigner -verify -verbose -certs "$aab_path" | tee "$jarsigner_evidence"
grep -Fq 'jar verified.' "$jarsigner_evidence" || {
  echo 'ANDROID_AAB_SIGNATURE_NOT_VERIFIED' >&2
  exit 1
}

apk_cert_sha256="$($apksigner verify --print-certs "$apk_path" \
  | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
  | head -n 1 \
  | tr '[:upper:]' '[:lower:]' \
  | tr -d ':[:space:]')"

aab_cert_sha256="$(keytool -printcert -jarfile "$aab_path" \
  | sed -n 's/^[[:space:]]*SHA256: //p' \
  | head -n 1 \
  | tr '[:upper:]' '[:lower:]' \
  | tr -d ':[:space:]')"

if [[ ! "$apk_cert_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ANDROID_APK_SIGNER_FINGERPRINT_INVALID: '$apk_cert_sha256'" >&2
  exit 1
fi
if [[ ! "$aab_cert_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ANDROID_AAB_SIGNER_FINGERPRINT_INVALID: '$aab_cert_sha256'" >&2
  exit 1
fi
if [ "$apk_cert_sha256" != "$aab_cert_sha256" ]; then
  echo "ANDROID_RELEASE_SIGNER_MISMATCH apk=$apk_cert_sha256 aab=$aab_cert_sha256" >&2
  exit 1
fi

{
  echo "apk_signer_sha256=$apk_cert_sha256"
  echo "aab_signer_sha256=$aab_cert_sha256"
} | tee "$signer_evidence"

sha256sum "$aab_path" | tee "${aab_path}.sha256"
echo "ANDROID_SIGNED_AAB_VALIDATION_PASSED signer_sha256=$aab_cert_sha256"

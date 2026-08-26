#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?usage: validate-apk.sh path/to/app.apk [expected-package]}"
expected_package="${2:-com.pablovoice.studio.validation}"

test -f "$apk_path"
apk_bytes="$(stat -c '%s' "$apk_path")"
if [ "$apk_bytes" -lt 500000 ]; then
  echo "REGRESSION-006 FAIL: APK has only $apk_bytes bytes" >&2
  exit 1
fi

build_tools="${ANDROID_HOME:?ANDROID_HOME is required}/build-tools/35.0.0"
"$build_tools/zipalign" -c -P 16 -v 4 "$apk_path"
"$build_tools/apksigner" verify --verbose --print-certs "$apk_path"
badging="$($build_tools/aapt dump badging "$apk_path")"
grep -F "package: name='$expected_package'" <<<"$badging"

for asset in assets/index.html assets/app.js assets/styles.css assets/core/src/project.mjs assets/audio/src/presets.mjs; do
  unzip -l "$apk_path" "$asset" | grep -F "$asset"
done

if unzip -p "$apk_path" assets/app.js | grep -E "https://[^[:space:]\"']+\\.vercel\\.app" >/dev/null; then
  echo 'REGRESSION-001 FAIL: remote Vercel boot URL is present in the APK' >&2
  exit 1
fi

sha256sum "$apk_path" | tee "${apk_path}.sha256"
echo "APK_VALIDATION_PASSED bytes=$apk_bytes package=$expected_package"

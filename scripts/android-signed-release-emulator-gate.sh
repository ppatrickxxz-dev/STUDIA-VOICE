#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?usage: android-signed-release-emulator-gate.sh path/to/app-release.apk}"
evidence_root="${2:-test-results/android-signed-release-emulator}"
production_package="com.pablovoice.studio"
validation_package="com.pablovoice.studio.validation"
mkdir -p "$evidence_root"

test -f "$apk_path"

patch_gate_for_production() {
  local source="$1"
  local target="$2"
  python3 - "$source" "$target" "$validation_package" "$production_package" <<'PY'
from pathlib import Path
import sys
source, target, old, new = sys.argv[1:]
text = Path(source).read_text()
count = text.count(old)
if count != 1:
    raise SystemExit(f'ANDROID_SIGNED_RELEASE_PACKAGE_PATCH_UNSAFE source={source} matches={count}')
Path(target).write_text(text.replace(old, new))
PY
  chmod +x "$target"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

open_with_gate="$tmp_dir/android-open-with-project-emulator-gate.sh"
complete_flow_gate="$tmp_dir/android-complete-user-flow-gate.sh"
patch_gate_for_production scripts/android-open-with-project-emulator-gate.sh "$open_with_gate"
patch_gate_for_production scripts/android-complete-user-flow-gate.sh "$complete_flow_gate"

bash "$open_with_gate" "$apk_path" "$evidence_root/open-with-project"
bash "$complete_flow_gate" "$evidence_root/complete-user-flow"

adb shell pm path "$production_package" | tee "$evidence_root/installed-package-path.txt"
adb shell dumpsys package "$production_package" > "$evidence_root/installed-package.txt"
if adb shell pm path "$validation_package" 2>/dev/null | grep -q '^package:'; then
  echo 'ANDROID_SIGNED_RELEASE_VALIDATION_PACKAGE_PRESENT' >&2
  exit 1
fi

echo 'ANDROID_SIGNED_RELEASE_PHYSICAL_GATE_PASSED'

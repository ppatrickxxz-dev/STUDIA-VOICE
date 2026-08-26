#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?usage: android-emulator-gate.sh path/to/app.apk}"
package_name="com.pablovoice.studio.validation"
activity_name="com.pablovoice.studio.MainActivity"
evidence_dir="${2:-test-results/android-emulator}"
mkdir -p "$evidence_dir"

adb install -r "$apk_path"
adb shell pm grant "$package_name" android.permission.RECORD_AUDIO
adb shell svc wifi disable || true
adb shell svc data disable || true
adb shell settings put global airplane_mode_on 1 || true

launch_and_wait() {
  adb shell am force-stop "$package_name"
  adb shell am start -W -n "$package_name/$activity_name" | tee "$evidence_dir/launch.txt"
  for attempt in $(seq 1 30); do
    adb shell uiautomator dump /sdcard/pv-window.xml >/dev/null 2>&1 || true
    adb pull /sdcard/pv-window.xml "$evidence_dir/window.xml" >/dev/null 2>&1 || true
    if grep -Eq 'Você tá no estúdio|PabloVoice|Sua ideia ganha som' "$evidence_dir/window.xml" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo 'ANDROID_BOOT_TEXT_GATE_FAILED' >&2
  return 1
}

launch_and_wait
adb exec-out screencap -p > "$evidence_dir/launch-offline.png"
variation="$(convert "$evidence_dir/launch-offline.png" -colorspace Gray -format '%[fx:standard_deviation]' info:)"
awk -v value="$variation" 'BEGIN { if (value <= 0.02) exit 1 }' || {
  echo "REGRESSION-007 FAIL: screenshot variation $variation indicates a blank/black render" >&2
  exit 1
}

adb shell input keyevent KEYCODE_HOME
sleep 1
adb shell am start -W -n "$package_name/$activity_name" > "$evidence_dir/foreground.txt"
adb exec-out screencap -p > "$evidence_dir/foreground.png"
launch_and_wait
adb exec-out screencap -p > "$evidence_dir/relaunch-offline.png"
adb logcat -d -v threadtime > "$evidence_dir/logcat.txt"
adb shell pidof "$package_name" | tee "$evidence_dir/pid.txt"

echo "ANDROID_NON_MIC_GATES_PASSED visual_standard_deviation=$variation"
echo 'MIC_CAPTURE_REQUIRES_PHYSICAL_DEVICE'


#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?usage: android-emulator-gate.sh path/to/app.apk}"
package_name="com.pablovoice.studio.validation"
activity_name="com.pablovoice.studio.MainActivity"
evidence_dir="${2:-test-results/android-emulator}"
mkdir -p "$evidence_dir"

adb install -r "$apk_path"
adb shell pm grant "$package_name" android.permission.RECORD_AUDIO || true
adb shell svc wifi disable || true
adb shell svc data disable || true
adb shell settings put global airplane_mode_on 1 || true

capture_diagnostics() {
  local label="${1:-failure}"
  adb logcat -d -v threadtime > "$evidence_dir/${label}-logcat.txt" || true
  adb shell dumpsys activity activities > "$evidence_dir/${label}-activities.txt" || true
  adb shell dumpsys window windows > "$evidence_dir/${label}-windows.txt" || true
  adb exec-out screencap -p > "$evidence_dir/${label}.png" 2>/dev/null || true
}

frame_variation() {
  local image="$1"
  convert "$image" -colorspace Gray -format '%[fx:standard_deviation]' info: 2>/dev/null || echo 0
}

is_foreground() {
  local activity window
  activity="$(adb shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -E 'mResumedActivity|topResumedActivity' | grep "$package_name" || true)"
  window="$(adb shell dumpsys window windows 2>/dev/null | tr -d '\r' | grep -E 'mCurrentFocus|mFocusedApp' | grep "$package_name" || true)"
  [ -n "$activity" ] || [ -n "$window" ]
}

assert_no_fatal_crash() {
  local log="$1"
  if grep -Eq "FATAL EXCEPTION|Process: ${package_name}.*FATAL" "$log" 2>/dev/null; then
    echo 'ANDROID_FATAL_CRASH_DETECTED' >&2
    return 1
  fi
}

launch_and_wait() {
  local label="$1"
  adb shell am force-stop "$package_name" || true
  adb logcat -c || true

  # GitHub-hosted runners may expose no KVM. `am start -W` can therefore time out
  # even though the process subsequently becomes healthy. Record its result, then
  # use process + foreground activity + nonblank render as the actual emulator gate.
  timeout 35s adb shell am start -W -n "$package_name/$activity_name" \
    > "$evidence_dir/${label}-launch.txt" 2>&1 || true

  for attempt in $(seq 1 45); do
    local pid variation
    pid="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
    adb exec-out screencap -p > "$evidence_dir/${label}.png" 2>/dev/null || true
    variation="$(frame_variation "$evidence_dir/${label}.png")"

    if [ -n "$pid" ] && is_foreground && awk -v value="$variation" 'BEGIN { exit !(value > 0.02) }'; then
      adb logcat -d -v threadtime > "$evidence_dir/${label}-logcat.txt" || true
      assert_no_fatal_crash "$evidence_dir/${label}-logcat.txt"
      adb shell dumpsys activity activities > "$evidence_dir/${label}-activities.txt" || true
      adb shell dumpsys window windows > "$evidence_dir/${label}-windows.txt" || true
      printf '%s\n' "$pid" > "$evidence_dir/${label}-pid.txt"
      printf '%s\n' "$variation" > "$evidence_dir/${label}-variation.txt"
      return 0
    fi
    sleep 2
  done

  capture_diagnostics "${label}-failure"
  echo "ANDROID_RENDER_GATE_FAILED label=$label" >&2
  return 1
}

launch_and_wait launch-offline

adb shell input keyevent KEYCODE_HOME || true
sleep 2
launch_and_wait foreground

# UIAutomator is captured only as supplemental evidence. WebView DOM text is not a
# reliable Android accessibility contract and must not be the sole boot criterion.
adb shell uiautomator dump /sdcard/pv-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/pv-window.xml "$evidence_dir/window.xml" >/dev/null 2>&1 || true

launch_variation="$(cat "$evidence_dir/launch-offline-variation.txt")"
foreground_variation="$(cat "$evidence_dir/foreground-variation.txt")"
echo "ANDROID_EMULATOR_NON_MIC_GATE_PASSED launch_variation=$launch_variation foreground_variation=$foreground_variation"
echo 'MIC_CAPTURE_REQUIRES_PHYSICAL_DEVICE'

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

assert_native_package_contract() {
  local package_dump="$evidence_dir/package-contract.txt"
  local appops_dump="$evidence_dir/package-appops.txt"
  adb shell dumpsys package "$package_name" > "$package_dump" 2>/dev/null || true
  adb shell appops get "$package_name" RECORD_AUDIO > "$appops_dump" 2>/dev/null || true

  if ! grep -q "android.permission.RECORD_AUDIO" "$package_dump"; then
    capture_diagnostics package-contract-missing-record-audio
    echo 'ANDROID_NATIVE_RECORD_AUDIO_PERMISSION_MISSING' >&2
    return 1
  fi
  if ! grep -Eq "android.permission.RECORD_AUDIO: granted=true|RECORD_AUDIO: allow" "$package_dump" "$appops_dump" 2>/dev/null; then
    capture_diagnostics package-contract-record-audio-not-granted
    echo 'ANDROID_NATIVE_RECORD_AUDIO_PERMISSION_NOT_GRANTED' >&2
    return 1
  fi
  if ! grep -q "$activity_name" "$package_dump"; then
    capture_diagnostics package-contract-missing-activity
    echo 'ANDROID_NATIVE_MAIN_ACTIVITY_MISSING' >&2
    return 1
  fi
  if ! grep -Eq "android.intent.action.VIEW|android.intent.action.SEND|audio/\*" "$package_dump"; then
    capture_diagnostics package-contract-missing-audio-entrypoint
    echo 'ANDROID_NATIVE_AUDIO_IMPORT_ENTRYPOINT_MISSING' >&2
    return 1
  fi
  echo 'ANDROID_NATIVE_PACKAGE_CONTRACT_PASSED'
}

process_start_ticks() {
  local pid="$1"
  adb shell cat "/proc/$pid/stat" 2>/dev/null | tr -d '\r' | awk '{print $22}'
}

launch_and_wait() {
  local label="$1"
  adb shell am force-stop "$package_name" || true
  adb logcat -c || true
  timeout 35s adb shell am start -W -n "$package_name/$activity_name" > "$evidence_dir/${label}-launch.txt" 2>&1 || true

  wait_for_render "$label"
}

wait_for_render() {
  local label="$1"

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

wait_for_background() {
  for attempt in $(seq 1 15); do
    if ! is_foreground; then return 0; fi
    sleep 1
  done
  capture_diagnostics background-failure
  echo 'ANDROID_BACKGROUND_GATE_FAILED' >&2
  return 1
}

resume_and_wait() {
  adb logcat -c || true
  timeout 35s adb shell am start -W -n "$package_name/$activity_name" > "$evidence_dir/foreground-resume-launch.txt" 2>&1 || true
  wait_for_render foreground-resume
}

assert_native_package_contract
launch_and_wait launch-offline
launch_pid="$(cat "$evidence_dir/launch-offline-pid.txt")"
launch_start_ticks="$(process_start_ticks "$launch_pid")"
if [ -z "$launch_start_ticks" ]; then
  echo 'ANDROID_LAUNCH_PROCESS_IDENTITY_MISSING' >&2
  exit 1
fi
adb shell input keyevent KEYCODE_HOME || true
wait_for_background
background_pid="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
if [ -z "$background_pid" ]; then
  capture_diagnostics background-process-lost
  echo 'ANDROID_BACKGROUND_PROCESS_LOST' >&2
  exit 1
fi
if [ "$background_pid" != "$launch_pid" ]; then
  capture_diagnostics background-pid-changed
  echo "ANDROID_BACKGROUND_PID_CHANGED launch=$launch_pid background=$background_pid" >&2
  exit 1
fi
background_start_ticks="$(process_start_ticks "$background_pid")"
if [ "$background_start_ticks" != "$launch_start_ticks" ]; then
  capture_diagnostics background-process-changed
  echo "ANDROID_BACKGROUND_PROCESS_CHANGED launch_ticks=$launch_start_ticks background_ticks=$background_start_ticks" >&2
  exit 1
fi
printf '%s\n' "$background_pid" > "$evidence_dir/background-pid.txt"
printf '%s\n' "$background_start_ticks" > "$evidence_dir/background-start-ticks.txt"
capture_diagnostics background

resume_and_wait
resume_pid="$(cat "$evidence_dir/foreground-resume-pid.txt")"
if [ "$resume_pid" != "$launch_pid" ]; then
  capture_diagnostics foreground-resume-pid-changed
  echo "ANDROID_RESUME_PID_CHANGED launch=$launch_pid resume=$resume_pid" >&2
  exit 1
fi
resume_start_ticks="$(process_start_ticks "$resume_pid")"
if [ "$resume_start_ticks" != "$launch_start_ticks" ]; then
  capture_diagnostics foreground-resume-process-changed
  echo "ANDROID_RESUME_PROCESS_CHANGED launch_ticks=$launch_start_ticks resume_ticks=$resume_start_ticks" >&2
  exit 1
fi

launch_and_wait relaunch
relaunch_pid="$(cat "$evidence_dir/relaunch-pid.txt")"
relaunch_start_ticks="$(process_start_ticks "$relaunch_pid")"
if [ -z "$relaunch_start_ticks" ]; then
  echo 'ANDROID_RELAUNCH_PROCESS_IDENTITY_MISSING' >&2
  exit 1
fi
if [ "$relaunch_pid" = "$launch_pid" ] && [ "$relaunch_start_ticks" = "$launch_start_ticks" ]; then
  capture_diagnostics relaunch-process-not-restarted
  echo "ANDROID_RELAUNCH_PROCESS_NOT_RESTARTED pid=$launch_pid start_ticks=$launch_start_ticks" >&2
  exit 1
fi

adb shell uiautomator dump /sdcard/pv-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/pv-window.xml "$evidence_dir/window.xml" >/dev/null 2>&1 || true

launch_variation="$(cat "$evidence_dir/launch-offline-variation.txt")"
foreground_variation="$(cat "$evidence_dir/foreground-resume-variation.txt")"
relaunch_variation="$(cat "$evidence_dir/relaunch-variation.txt")"
echo "ANDROID_EMULATOR_LIFECYCLE_GATE_PASSED launch_pid=$launch_pid launch_ticks=$launch_start_ticks resume_pid=$resume_pid resume_ticks=$resume_start_ticks relaunch_pid=$relaunch_pid relaunch_ticks=$relaunch_start_ticks launch_variation=$launch_variation foreground_variation=$foreground_variation relaunch_variation=$relaunch_variation"
echo 'ANDROID_NATIVE_PACKAGE_CONTRACT_EVIDENCE_CAPTURED'
echo 'MIC_CAPTURE_REQUIRES_PHYSICAL_DEVICE'

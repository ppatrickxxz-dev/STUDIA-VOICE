#!/usr/bin/env bash
set -euo pipefail

package_name="com.pablovoice.studio.validation"
activity_name="com.pablovoice.studio.MainActivity"
evidence_dir="${1:-test-results/android-complete-user-flow}"
mkdir -p "$evidence_dir"

capture_diagnostics() {
  local label="${1:-failure}"
  adb logcat -d -v threadtime > "$evidence_dir/${label}-logcat.txt" || true
  adb shell dumpsys activity activities > "$evidence_dir/${label}-activities.txt" || true
  adb shell dumpsys window windows > "$evidence_dir/${label}-windows.txt" || true
  adb exec-out screencap -p > "$evidence_dir/${label}.png" 2>/dev/null || true
}

is_foreground() {
  local activity window
  activity="$(adb shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -E 'mResumedActivity|topResumedActivity' | grep "$package_name" || true)"
  window="$(adb shell dumpsys window windows 2>/dev/null | tr -d '\r' | grep -E 'mCurrentFocus|mFocusedApp' | grep "$package_name" || true)"
  [ -n "$activity" ] || [ -n "$window" ]
}

wait_for_render() {
  local label="$1"
  for attempt in $(seq 1 45); do
    local pid
    pid="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
    if [ -n "$pid" ] && is_foreground; then
      printf '%s\n' "$pid" > "$evidence_dir/${label}-pid.txt"
      adb logcat -d -v threadtime > "$evidence_dir/${label}-logcat.txt" || true
      return 0
    fi
    sleep 2
  done
  capture_diagnostics "${label}-render-failure"
  echo "ANDROID_COMPLETE_USER_FLOW_RENDER_FAILED label=$label" >&2
  return 1
}

forward_webview_devtools() {
  local pid socket_name
  pid="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
  if [ -z "$pid" ]; then
    capture_diagnostics complete-flow-missing-pid
    echo 'ANDROID_COMPLETE_USER_FLOW_PID_MISSING' >&2
    return 1
  fi
  socket_name="$(adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' | grep -o "webview_devtools_remote_${pid}" | head -n 1 || true)"
  if [ -z "$socket_name" ]; then
    socket_name="$(adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' | grep -o 'webview_devtools_remote_[^ ]*' | head -n 1 || true)"
  fi
  if [ -z "$socket_name" ]; then
    capture_diagnostics complete-flow-devtools-missing
    echo 'ANDROID_COMPLETE_USER_FLOW_DEVTOOLS_SOCKET_MISSING' >&2
    return 1
  fi
  adb forward --remove tcp:9225 >/dev/null 2>&1 || true
  adb forward tcp:9225 "localabstract:${socket_name}" > "$evidence_dir/devtools-forward.txt" 2>&1
}

run_phase() {
  local phase="$1"
  local expected_marker="$2"
  forward_webview_devtools
  if ! PV_FLOW_PHASE="$phase" PV_EXPECTED_MARKER="$expected_marker" python3 > "$evidence_dir/${phase}-devtools.txt" <<'PY'
import base64
import json
import os
import socket
import struct
import time
import urllib.request

phase = os.environ['PV_FLOW_PHASE']
expected = os.environ['PV_EXPECTED_MARKER']
deadline = time.monotonic() + 75
attempt = 0

def load_page_path():
    pages = json.loads(urllib.request.urlopen('http://127.0.0.1:9225/json', timeout=5).read().decode('utf-8'))
    page = next((item for item in pages if item.get('type') == 'page' and item.get('webSocketDebuggerUrl')), None)
    if not page:
        raise RuntimeError(f'NO_PAGE_TARGET pages={len(pages)}')
    ws_url = page['webSocketDebuggerUrl']
    if not (ws_url.startswith('ws://127.0.0.1:9225') or ws_url.startswith('ws://localhost:9225')):
        raise RuntimeError(f'UNEXPECTED_DEVTOOLS_URL {ws_url}')
    return '/' + ws_url.split('://', 1)[1].split('/', 1)[1]

def send_text(sock, message):
    payload = message.encode('utf-8')
    header = bytearray([0x81])
    if len(payload) < 126:
        header.append(0x80 | len(payload))
    elif len(payload) < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack('!H', len(payload)))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack('!Q', len(payload)))
    mask = os.urandom(4)
    header.extend(mask)
    sock.sendall(bytes(header) + bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload)))

def recv_text(sock):
    first = sock.recv(2)
    if len(first) < 2:
        raise RuntimeError('websocket closed')
    opcode = first[0] & 0x0F
    length = first[1] & 0x7F
    if length == 126:
        length = struct.unpack('!H', sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack('!Q', sock.recv(8))[0]
    mask = sock.recv(4) if first[1] & 0x80 else None
    payload = b''
    while len(payload) < length:
        payload += sock.recv(length - len(payload))
    if mask:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    if opcode == 8:
        raise RuntimeError('websocket close frame')
    if opcode not in (1, 0):
        return ''
    return payload.decode('utf-8', 'replace')

def evaluate(expression):
    path = load_page_path()
    key = base64.b64encode(os.urandom(16)).decode('ascii')
    sock = socket.create_connection(('127.0.0.1', 9225), timeout=8)
    sock.settimeout(15)
    try:
        sock.sendall((
            f'GET {path} HTTP/1.1\r\n'
            'Host: 127.0.0.1:9225\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            f'Sec-WebSocket-Key: {key}\r\n'
            'Sec-WebSocket-Version: 13\r\n\r\n'
        ).encode('ascii'))
        response = b''
        while b'\r\n\r\n' not in response:
            response += sock.recv(4096)
        if b' 101 ' not in response.split(b'\r\n', 1)[0]:
            raise RuntimeError(response.decode('utf-8', 'replace'))
        send_text(sock, json.dumps({
            'id': 1,
            'method': 'Runtime.evaluate',
            'params': {
                'expression': expression,
                'awaitPromise': True,
                'returnByValue': True,
                'timeout': 12000,
            },
        }))
        while True:
            raw = recv_text(sock)
            if not raw:
                continue
            data = json.loads(raw)
            if data.get('id') == 1:
                return data
    finally:
        try:
            sock.close()
        except Exception:
            pass

common = r"""
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const readImportedTrack = () => new Promise((resolveTrack, rejectTrack) => {
  const request = indexedDB.open('pablovoice_mobile_v2');
  request.onerror = () => rejectTrack(request.error || new Error('INDEXEDDB_OPEN_FAILED'));
  request.onsuccess = () => {
    const db = request.result;
    try {
      const stores = Array.from(db.objectStoreNames || []);
      if (!stores.includes('projects')) {
        db.close();
        resolveTrack({ ready: false, reason: 'PROJECT_STORE_NOT_READY', stores });
        return;
      }
      const tx = db.transaction('projects', 'readonly');
      const all = tx.objectStore('projects').getAll();
      all.onerror = () => { db.close(); rejectTrack(all.error || new Error('PROJECT_READ_FAILED')); };
      all.onsuccess = () => {
        const projects = all.result || [];
        const match = projects.flatMap((project) => (project.tracks || []).map((track) => ({ project, track })))
          .find(({ track }) => String(track.name || '').includes('pv-android-import-smoke'));
        db.close();
        if (!match) {
          resolveTrack({ ready: false, reason: 'IMPORTED_TRACK_NOT_FOUND', projects: projects.length });
          return;
        }
        resolveTrack({
          ready: true,
          projectId: match.project.id,
          projectName: match.project.name,
          preset: match.project.preset,
          trackId: match.track.id,
          trackName: match.track.name,
          clean: match.track.effects?.clean === true,
        });
      };
    } catch (error) {
      db.close();
      rejectTrack(error);
    }
  };
});
"""

if phase == 'edit-save':
    expression = """(async () => {
%s
  if (document.documentElement.dataset.pvReady !== 'true') return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'APP_NOT_READY' };
  const studio = document.querySelector('[data-route="studio"]');
  if (!studio) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'STUDIO_ROUTE_MISSING' };
  studio.click();
  await delay(250);
  const voice = document.querySelector('[data-action="studio-tab"][data-value="voice"]');
  if (!voice) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'VOICE_TAB_MISSING' };
  voice.click();
  await delay(250);
  const clean = document.querySelector('[data-action="effect"][data-value="clean"]');
  if (!clean) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'CLEAN_EFFECT_MISSING' };
  if (!clean.classList.contains('on')) {
    clean.click();
    await delay(250);
  }
  const save = document.querySelector('[data-action="save"]');
  if (!save) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'SAVE_ACTION_MISSING' };
  save.click();
  for (let index = 0; index < 24; index += 1) {
    await delay(250);
    const persisted = await readImportedTrack();
    if (persisted.ready && persisted.clean) return { marker: 'ANDROID_COMPLETE_EDIT_SAVE_PASSED', ...persisted };
  }
  const persisted = await readImportedTrack();
  return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'EDIT_NOT_PERSISTED', ...persisted };
})()""" % common
else:
    expression = """(async () => {
%s
  if (document.documentElement.dataset.pvReady !== 'true') return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'APP_NOT_READY' };
  const persisted = await readImportedTrack();
  if (!persisted.ready) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: persisted.reason || 'PROJECT_NOT_READY', ...persisted };
  if (!persisted.clean) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'EDIT_NOT_PERSISTED_AFTER_RELAUNCH', ...persisted };
  const studio = document.querySelector('[data-route="studio"]');
  if (!studio) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'STUDIO_ROUTE_MISSING', ...persisted };
  studio.click();
  await delay(250);
  const exportButton = document.querySelector('[data-action="export"]');
  if (!exportButton || exportButton.disabled) return { marker: 'ANDROID_COMPLETE_USER_FLOW_WAITING', reason: 'EXPORT_ACTION_MISSING', ...persisted };
  exportButton.click();
  return { marker: 'ANDROID_COMPLETE_RELAUNCH_EXPORT_TRIGGERED', ...persisted };
})()""" % common

while time.monotonic() < deadline:
    attempt += 1
    try:
        data = evaluate(expression)
        result = data.get('result', {}).get('result', {})
        value = result.get('value') or {}
        print(json.dumps({'attempt': attempt, 'phase': phase, 'value': value}, sort_keys=True), flush=True)
        if data.get('result', {}).get('exceptionDetails'):
            raise RuntimeError(json.dumps(data, sort_keys=True))
        if value.get('marker') == expected:
            raise SystemExit(0)
    except Exception as error:
        print(json.dumps({'attempt': attempt, 'phase': phase, 'retryableError': str(error)}, sort_keys=True), flush=True)
    time.sleep(1)

print(json.dumps({'phase': phase, 'marker': 'ANDROID_COMPLETE_USER_FLOW_PHASE_MISSING', 'expected': expected}, sort_keys=True), flush=True)
raise SystemExit(2)
PY
  then
    adb forward --remove tcp:9225 >/dev/null 2>&1 || true
    capture_diagnostics "${phase}-failure"
    echo "ANDROID_COMPLETE_USER_FLOW_PHASE_FAILED phase=$phase" >&2
    return 1
  fi
  adb forward --remove tcp:9225 >/dev/null 2>&1 || true
  if ! grep -q "$expected_marker" "$evidence_dir/${phase}-devtools.txt"; then
    capture_diagnostics "${phase}-marker-missing"
    echo "ANDROID_COMPLETE_USER_FLOW_MARKER_MISSING phase=$phase marker=$expected_marker" >&2
    return 1
  fi
}

wait_for_render complete-flow-start
run_phase edit-save ANDROID_COMPLETE_EDIT_SAVE_PASSED
capture_diagnostics edit-save-success

adb shell "mkdir -p /sdcard/Download/PabloVoice && rm -f /sdcard/Download/PabloVoice/*.wav" >/dev/null 2>&1 || true
adb shell am force-stop "$package_name" || true
adb logcat -c || true
timeout 35s adb shell am start -W -n "$package_name/$activity_name" > "$evidence_dir/relaunch.txt" 2>&1 || true
wait_for_render complete-flow-relaunch
run_phase relaunch-export ANDROID_COMPLETE_RELAUNCH_EXPORT_TRIGGERED

export_file=""
for attempt in $(seq 1 40); do
  export_file="$(adb shell "find /sdcard/Download/PabloVoice -maxdepth 1 -type f -name '*.wav' 2>/dev/null | head -n 1" | tr -d '\r' || true)"
  if [ -n "$export_file" ]; then
    export_size="$(adb shell stat -c %s "$export_file" 2>/dev/null | tr -d '\r' || true)"
    if [[ "$export_size" =~ ^[0-9]+$ ]] && [ "$export_size" -gt 44 ]; then
      printf '%s\n' "$export_file" > "$evidence_dir/export-file-path.txt"
      printf '%s\n' "$export_size" > "$evidence_dir/export-file-size.txt"
      break
    fi
  fi
  sleep 1
done

if [ -z "$export_file" ]; then
  capture_diagnostics export-file-missing
  echo 'ANDROID_COMPLETE_USER_FLOW_EXPORT_FILE_MISSING' >&2
  exit 1
fi

adb pull "$export_file" "$evidence_dir/exported-mix.wav" > "$evidence_dir/export-pull.txt" 2>&1
python3 - "$evidence_dir/exported-mix.wav" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
data = path.read_bytes()
if len(data) <= 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
    raise SystemExit('ANDROID_COMPLETE_USER_FLOW_EXPORT_WAV_INVALID')
print(f'ANDROID_COMPLETE_USER_FLOW_EXPORT_WAV_PASSED bytes={len(data)}')
PY

capture_diagnostics complete-user-flow-success
echo 'ANDROID_COMPLETE_USER_FLOW_GATE_PASSED'

#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?usage: android-import-emulator-gate.sh path/to/app.apk}"
package_name="com.pablovoice.studio.validation"
activity_name="com.pablovoice.studio.MainActivity"
evidence_dir="${2:-test-results/android-import-emulator}"
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

is_foreground() {
  local activity window
  activity="$(adb shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -E 'mResumedActivity|topResumedActivity' | grep "$package_name" || true)"
  window="$(adb shell dumpsys window windows 2>/dev/null | tr -d '\r' | grep -E 'mCurrentFocus|mFocusedApp' | grep "$package_name" || true)"
  [ -n "$activity" ] || [ -n "$window" ]
}

assert_no_fatal_crash() {
  local log="$1"
  if grep -Eq "FATAL EXCEPTION|Process: ${package_name}.*FATAL" "$log" 2>/dev/null; then
    echo 'ANDROID_IMPORT_FATAL_CRASH_DETECTED' >&2
    return 1
  fi
}

wait_for_render() {
  local label="$1"
  for attempt in $(seq 1 45); do
    local pid
    pid="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
    adb exec-out screencap -p > "$evidence_dir/${label}.png" 2>/dev/null || true
    if [ -n "$pid" ] && is_foreground; then
      adb logcat -d -v threadtime > "$evidence_dir/${label}-logcat.txt" || true
      assert_no_fatal_crash "$evidence_dir/${label}-logcat.txt"
      adb shell dumpsys activity activities > "$evidence_dir/${label}-activities.txt" || true
      adb shell dumpsys window windows > "$evidence_dir/${label}-windows.txt" || true
      printf '%s\n' "$pid" > "$evidence_dir/${label}-pid.txt"
      return 0
    fi
    sleep 2
  done
  capture_diagnostics "${label}-failure"
  echo "ANDROID_IMPORT_RENDER_GATE_FAILED label=$label" >&2
  return 1
}

make_wav() {
  python3 - "$1" <<'PY'
import math
import struct
import sys
path = sys.argv[1]
sample_rate = 44100
seconds = 0.25
frames = int(sample_rate * seconds)
with open(path, 'wb') as handle:
    handle.write(b'RIFF')
    handle.write(struct.pack('<I', 36 + frames * 2))
    handle.write(b'WAVEfmt ')
    handle.write(struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    handle.write(b'data')
    handle.write(struct.pack('<I', frames * 2))
    for index in range(frames):
        sample = int(math.sin(2 * math.pi * 440 * index / sample_rate) * 9000)
        handle.write(struct.pack('<h', sample))
PY
}

forward_webview_devtools() {
  local pid socket_name
  pid="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
  if [ -z "$pid" ]; then
    capture_diagnostics import-smoke-missing-pid
    echo 'ANDROID_IMPORT_OPEN_WITH_PID_MISSING' >&2
    return 1
  fi
  socket_name="$(adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' | grep -o "webview_devtools_remote_${pid}" | head -n 1 || true)"
  if [ -z "$socket_name" ]; then
    socket_name="$(adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' | grep -o 'webview_devtools_remote_[^ ]*' | head -n 1 || true)"
  fi
  if [ -z "$socket_name" ]; then
    capture_diagnostics import-smoke-devtools-missing
    echo 'ANDROID_IMPORT_OPEN_WITH_DEVTOOLS_SOCKET_MISSING' >&2
    return 1
  fi
  adb forward --remove tcp:9223 >/dev/null 2>&1 || true
  adb forward tcp:9223 "localabstract:${socket_name}" > "$evidence_dir/import-smoke-forward.txt" 2>&1
}

assert_pending_import_bridge() {
  forward_webview_devtools
  python3 > "$evidence_dir/import-smoke-devtools.txt" <<'PY'
import base64
import json
import os
import socket
import struct
import urllib.request

pages = json.loads(urllib.request.urlopen('http://127.0.0.1:9223/json', timeout=10).read().decode('utf-8'))
page = next((item for item in pages if item.get('type') == 'page'), pages[0])
ws_url = page['webSocketDebuggerUrl']
assert ws_url.startswith('ws://127.0.0.1:9223') or ws_url.startswith('ws://localhost:9223')
path = '/' + ws_url.split('://', 1)[1].split('/', 1)[1]

key = base64.b64encode(os.urandom(16)).decode('ascii')
sock = socket.create_connection(('127.0.0.1', 9223), timeout=10)
sock.settimeout(30)
sock.sendall((
    f'GET {path} HTTP/1.1\r\n'
    'Host: 127.0.0.1:9223\r\n'
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

def send_text(message):
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

def recv_text():
    first = sock.recv(2)
    if len(first) < 2:
        raise RuntimeError('websocket closed')
    opcode = first[0] & 0x0F
    length = first[1] & 0x7F
    if length == 126:
        length = struct.unpack('!H', sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack('!Q', sock.recv(8))[0]
    payload = b''
    while len(payload) < length:
        payload += sock.recv(length - len(payload))
    if opcode == 8:
        raise RuntimeError('websocket close frame')
    return payload.decode('utf-8')

expression = r"""
(() => new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = () => {
    try {
      const bridge = globalThis.PabloVoiceAndroid;
      if (!bridge || typeof bridge.pendingImportSize !== 'function') throw new Error('BRIDGE_MISSING');
      const size = Number(bridge.pendingImportSize() || 0);
      const name = String(bridge.pendingImportName() || '');
      const mime = String(bridge.pendingImportMime() || '');
      const chunk = String(bridge.pendingImportChunkBase64(0, 12) || '');
      if (size > 44 && name.includes('pv-android-import-smoke') && chunk.length > 8) {
        bridge.clearPendingImport();
        resolve({ marker: 'ANDROID_IMPORT_OPEN_WITH_PENDING_SMOKE_PASSED', size, name, mime, chunk });
        return;
      }
      if (Date.now() - started > 15000) {
        reject(new Error(`PENDING_IMPORT_TIMEOUT size=${size} name=${name} mime=${mime} chunk=${chunk.length}`));
        return;
      }
      setTimeout(poll, 500);
    } catch (error) {
      reject(error);
    }
  };
  poll();
}))()
"""
command = {
    'id': 1,
    'method': 'Runtime.evaluate',
    'params': {
        'expression': expression,
        'awaitPromise': True,
        'returnByValue': True,
        'timeout': 20000,
    },
}
send_text(json.dumps(command))
while True:
    data = json.loads(recv_text())
    if data.get('id') != 1:
        continue
    print(json.dumps(data, sort_keys=True))
    result = data.get('result', {}).get('result', {})
    if result.get('subtype') == 'error' or 'exceptionDetails' in data.get('result', {}):
        raise RuntimeError(json.dumps(data, sort_keys=True))
    value = result.get('value') or {}
    if value.get('marker') != 'ANDROID_IMPORT_OPEN_WITH_PENDING_SMOKE_PASSED':
        raise RuntimeError(json.dumps(data, sort_keys=True))
    break
PY
  adb forward --remove tcp:9223 >/dev/null 2>&1 || true
  if ! grep -q 'ANDROID_IMPORT_OPEN_WITH_PENDING_SMOKE_PASSED' "$evidence_dir/import-smoke-devtools.txt"; then
    capture_diagnostics import-smoke-pending-missing
    echo 'ANDROID_IMPORT_OPEN_WITH_PENDING_SMOKE_MISSING' >&2
    return 1
  fi
  echo 'ANDROID_IMPORT_OPEN_WITH_PENDING_SMOKE_PASSED'
}

local_wav="$evidence_dir/pv-android-import-smoke.wav"
remote_wav="/sdcard/Download/pv-android-import-smoke.wav"
make_wav "$local_wav"
adb push "$local_wav" "$remote_wav" > "$evidence_dir/import-smoke-push.txt" 2>&1
adb shell ls -l "$remote_wav" > "$evidence_dir/import-smoke-source-file.txt" 2>&1
adb shell am force-stop "$package_name" || true
adb logcat -c || true
timeout 35s adb shell am start -W -n "$package_name/$activity_name" -a android.intent.action.VIEW -d "file://${remote_wav}" -t audio/wav > "$evidence_dir/import-smoke-launch.txt" 2>&1 || true
wait_for_render import-open-with
assert_pending_import_bridge
capture_diagnostics import-open-with-success
echo 'ANDROID_IMPORT_OPEN_WITH_GATE_PASSED'

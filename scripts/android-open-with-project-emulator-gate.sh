#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?usage: android-open-with-project-emulator-gate.sh path/to/app.apk}"
package_name="com.pablovoice.studio.validation"
activity_name="com.pablovoice.studio.MainActivity"
evidence_dir="${2:-test-results/android-open-with-project-emulator}"
mkdir -p "$evidence_dir"

adb install -r "$apk_path"
adb shell pm clear "$package_name" || true
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
    echo 'ANDROID_OPEN_WITH_PROJECT_FATAL_CRASH_DETECTED' >&2
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
  echo "ANDROID_OPEN_WITH_PROJECT_RENDER_GATE_FAILED label=$label" >&2
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

resolve_media_import_uri() {
  local name="$1"
  local remote_path="$2"
  local query_file line id uri base
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${remote_path}" > "$evidence_dir/open-with-project-media-scan.txt" 2>&1 || true
  for attempt in $(seq 1 30); do
    for base in \
      content://media/external_primary/audio/media \
      content://media/external/audio/media \
      content://media/external_primary/file \
      content://media/external/file; do
      query_file="$evidence_dir/open-with-project-media-query-${attempt}-$(basename "$base").txt"
      adb shell content query --uri "$base" --projection _id:_display_name:mime_type > "$query_file" 2>&1 || true
      line="$(grep "$name" "$query_file" | tail -n 1 || true)"
      if [ -n "$line" ]; then
        id="$(printf '%s\n' "$line" | sed -n 's/.*_id=\([0-9][0-9]*\).*/\1/p')"
        if [ -n "$id" ]; then
          uri="${base}/${id}"
          printf '%s\n' "$uri" > "$evidence_dir/open-with-project-content-uri.txt"
          echo "$uri"
          return 0
        fi
      fi
    done
    sleep 1
  done
  capture_diagnostics open-with-project-media-uri-missing
  echo 'ANDROID_OPEN_WITH_PROJECT_CONTENT_URI_MISSING' >&2
  return 1
}

forward_webview_devtools() {
  local pid socket_name
  pid="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
  if [ -z "$pid" ]; then
    capture_diagnostics open-with-project-missing-pid
    echo 'ANDROID_OPEN_WITH_PROJECT_PID_MISSING' >&2
    return 1
  fi
  socket_name="$(adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' | grep -o "webview_devtools_remote_${pid}" | head -n 1 || true)"
  if [ -z "$socket_name" ]; then
    socket_name="$(adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' | grep -o 'webview_devtools_remote_[^ ]*' | head -n 1 || true)"
  fi
  if [ -z "$socket_name" ]; then
    capture_diagnostics open-with-project-devtools-missing
    echo 'ANDROID_OPEN_WITH_PROJECT_DEVTOOLS_SOCKET_MISSING' >&2
    return 1
  fi
  adb forward --remove tcp:9224 >/dev/null 2>&1 || true
  adb forward tcp:9224 "localabstract:${socket_name}" > "$evidence_dir/open-with-project-forward.txt" 2>&1
}

assert_project_imported() {
  local label="$1"
  forward_webview_devtools
  curl --silent --show-error --max-time 10 http://127.0.0.1:9224/json > "$evidence_dir/${label}-devtools-pages.txt" || true
  # Expanded evidence names include open-with-project-project-devtools.txt and open-with-project-relaunch-project-devtools.txt.
  if ! PV_ASSERT_LABEL="$label" python3 > "$evidence_dir/${label}-project-devtools.txt" <<'PY'
import base64
import json
import os
import socket
import struct
import time
import urllib.request

label = os.environ.get('PV_ASSERT_LABEL', 'project')
deadline = time.monotonic() + 90
attempt = 0

def load_page_path():
    pages = json.loads(urllib.request.urlopen('http://127.0.0.1:9224/json', timeout=5).read().decode('utf-8'))
    page = next((item for item in pages if item.get('type') == 'page' and item.get('webSocketDebuggerUrl')), None)
    if not page:
        raise RuntimeError(f'NO_PAGE_TARGET pages={len(pages)}')
    ws_url = page['webSocketDebuggerUrl']
    if not (ws_url.startswith('ws://127.0.0.1:9224') or ws_url.startswith('ws://localhost:9224')):
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
    if first[1] & 0x80:
        mask = sock.recv(4)
    else:
        mask = None
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
    sock = socket.create_connection(('127.0.0.1', 9224), timeout=8)
    sock.settimeout(14)
    try:
        sock.sendall((
            f'GET {path} HTTP/1.1\r\n'
            'Host: 127.0.0.1:9224\r\n'
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
        command = {
            'id': 1,
            'method': 'Runtime.evaluate',
            'params': {
                'expression': expression,
                'awaitPromise': True,
                'returnByValue': True,
                'timeout': 11000,
            },
        }
        send_text(sock, json.dumps(command))
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

snapshot_expression = r"""
(() => new Promise((resolve) => {
  const bodyText = document.body?.innerText || '';
  const ready = document.documentElement.dataset.pvReady === 'true';
  const finish = (value) => resolve({ ready, state: document.readyState, href: location.href, bodyLength: bodyText.length, ...value });
  if (!ready) {
    finish({ marker: 'ANDROID_OPEN_WITH_PROJECT_IMPORT_WAITING', reason: 'APP_NOT_READY' });
    return;
  }
  const request = indexedDB.open('pablovoice_mobile_v2', 3);
  const timer = setTimeout(() => finish({ marker: 'ANDROID_OPEN_WITH_PROJECT_IMPORT_WAITING', reason: 'INDEXEDDB_TIMEOUT' }), 4500);
  const getAll = (database, store) => new Promise((resolveStore, rejectStore) => {
    const tx = database.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolveStore(request.result || []);
    request.onerror = () => rejectStore(request.error || new Error(`GET_ALL_${store}`));
  });
  request.onerror = () => { clearTimeout(timer); finish({ marker: 'ANDROID_OPEN_WITH_PROJECT_IMPORT_WAITING', reason: 'INDEXEDDB_OPEN_FAILED', message: String(request.error || '') }); };
  request.onsuccess = async () => {
    clearTimeout(timer);
    const db = request.result;
    try {
      const stores = Array.from(db.objectStoreNames || []);
      if (!stores.includes('projects') || !stores.includes('audio')) {
        finish({ marker: 'ANDROID_OPEN_WITH_PROJECT_IMPORT_WAITING', reason: 'PROJECT_STORES_NOT_READY', stores });
        return;
      }
      const [projects, audio] = await Promise.all([getAll(db, 'projects'), getAll(db, 'audio')]);
      const match = projects.flatMap((project) => (project.tracks || []).map((track) => ({ project, track })))
        .find(({ track }) => String(track.name || '').includes('pv-android-import-smoke'));
      const asset = match && audio.find((item) => item.id === match.track.assetId);
      const blobSize = asset?.blob?.size || 0;
      if (match && asset && blobSize > 44 && Number(match.track.duration) > 0 && Number(match.track.sampleRate) > 0) {
        finish({
          marker: 'ANDROID_OPEN_WITH_PROJECT_IMPORT_PASSED',
          projectId: match.project.id,
          trackId: match.track.id,
          trackName: match.track.name,
          assetId: match.track.assetId,
          duration: match.track.duration,
          sampleRate: match.track.sampleRate,
          channels: match.track.channels,
          blobSize,
          visible: bodyText.includes(match.track.name),
        });
        return;
      }
      finish({
        marker: 'ANDROID_OPEN_WITH_PROJECT_IMPORT_WAITING',
        reason: 'NOT_FOUND_YET',
        projects: projects.length,
        audio: audio.length,
        hasMatch: Boolean(match),
        blobSize,
      });
    } catch (error) {
      finish({ marker: 'ANDROID_OPEN_WITH_PROJECT_IMPORT_WAITING', reason: 'SNAPSHOT_ERROR', message: String(error?.message || error) });
    } finally {
      db.close();
    }
  };
}))()
"""

while time.monotonic() < deadline:
    attempt += 1
    try:
        data = evaluate(snapshot_expression)
        result = data.get('result', {}).get('result', {})
        value = result.get('value') or {}
        print(json.dumps({'attempt': attempt, 'label': label, 'value': value}, sort_keys=True), flush=True)
        if data.get('result', {}).get('exceptionDetails'):
            raise RuntimeError(json.dumps(data, sort_keys=True))
        if value.get('marker') == 'ANDROID_OPEN_WITH_PROJECT_IMPORT_PASSED':
            raise SystemExit(0)
    except Exception as error:
        print(json.dumps({'attempt': attempt, 'label': label, 'retryableError': str(error)}, sort_keys=True), flush=True)
    time.sleep(1)

print(json.dumps({'label': label, 'marker': 'ANDROID_OPEN_WITH_PROJECT_IMPORT_MISSING'}, sort_keys=True), flush=True)
raise SystemExit(2)
PY
  then
    capture_diagnostics "${label}-project-import-missing"
    if [[ "$label" == *relaunch* ]]; then
      echo 'ANDROID_OPEN_WITH_PROJECT_RELAUNCH_IMPORT_MISSING' >&2
    fi
    echo 'ANDROID_OPEN_WITH_PROJECT_IMPORT_MISSING' >&2
    return 1
  fi
  adb forward --remove tcp:9224 >/dev/null 2>&1 || true
  if ! grep -q 'ANDROID_OPEN_WITH_PROJECT_IMPORT_PASSED' "$evidence_dir/${label}-project-devtools.txt"; then
    capture_diagnostics "${label}-project-import-missing"
    echo 'ANDROID_OPEN_WITH_PROJECT_IMPORT_MISSING' >&2
    return 1
  fi
}

local_wav="$evidence_dir/pv-android-import-smoke.wav"
remote_wav="/sdcard/Download/pv-android-import-smoke.wav"
make_wav "$local_wav"
adb shell rm -f "$remote_wav" || true
adb push "$local_wav" "$remote_wav" > "$evidence_dir/open-with-project-push.txt" 2>&1
adb shell ls -l "$remote_wav" > "$evidence_dir/open-with-project-source-file.txt" 2>&1
import_uri="$(resolve_media_import_uri pv-android-import-smoke.wav "$remote_wav")"
adb shell am force-stop "$package_name" || true
adb logcat -c || true
timeout 35s adb shell am start -W -n "$package_name/$activity_name" -a android.intent.action.VIEW -d "$import_uri" -t audio/wav --grant-read-uri-permission > "$evidence_dir/open-with-project-launch.txt" 2>&1 || true
wait_for_render open-with-project
assert_project_imported open-with-project
capture_diagnostics open-with-project-success
adb shell am force-stop "$package_name" || true
adb logcat -c || true
timeout 35s adb shell am start -W -n "$package_name/$activity_name" > "$evidence_dir/open-with-project-relaunch.txt" 2>&1 || true
wait_for_render open-with-project-relaunch
assert_project_imported open-with-project-relaunch
capture_diagnostics open-with-project-relaunch-success
echo 'ANDROID_OPEN_WITH_PROJECT_IMPORT_GATE_PASSED'

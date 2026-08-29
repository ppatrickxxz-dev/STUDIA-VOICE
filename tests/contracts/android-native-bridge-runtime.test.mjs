import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const activityPath = 'apps/android/app/src/main/java/com/pablovoice/studio/MainActivity.java';
const manifestPath = 'apps/android/app/src/main/AndroidManifest.xml';
const activity = readFileSync(activityPath, 'utf8');
const manifest = readFileSync(manifestPath, 'utf8');

function methodBody(name) {
  const marker = new RegExp(`(?:^|\\n)\\s*(?:(?:public|private|protected|static|synchronized|final)\\s+)*[\\w<>\\[\\], ?]+\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const match = marker.exec(activity);
  assert.ok(match, `expected method ${name}`);
  const start = activity.indexOf('{', match.index);
  let depth = 0;
  for (let index = start; index < activity.length; index += 1) {
    const char = activity[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return activity.slice(match.index, index + 1);
    }
  }
  throw new Error(`Could not read method body for ${name}`);
}

function assertJavascriptMethod(name) {
  const pattern = new RegExp(`@JavascriptInterface\\s+public[^;{]+\\b${name}\\s*\\(`, 'm');
  assert.match(activity, pattern, `expected ${name} to be exposed to the WebView bridge`);
}

test('Android manifest declares microphone, local launcher and audio import entrypoints', () => {
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.hardware\.microphone"\s+android:required="false"/);
  assert.match(manifest, /android\.intent\.action\.MAIN/);
  assert.match(manifest, /android\.intent\.category\.LAUNCHER/);
  assert.match(manifest, /android\.intent\.action\.VIEW/);
  assert.match(manifest, /android\.intent\.action\.SEND/);
  assert.match(manifest, /android:mimeType="audio\/\*"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
});

test('WebView bridge is local-only, hardened and exposes the expected Android API surface', () => {
  assert.match(activity, /WebViewAssetLoader\.Builder\(\)/);
  assert.match(activity, /\.addPathHandler\("\/assets\/"/);
  assert.match(activity, /settings\.setJavaScriptEnabled\(true\)/);
  assert.match(activity, /settings\.setAllowFileAccess\(false\)/);
  assert.match(activity, /settings\.setAllowContentAccess\(true\)/);
  assert.match(activity, /settings\.setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
  assert.match(activity, /webView\.addJavascriptInterface\(bridge,\s*"PabloVoiceAndroid"\)/);
  assert.match(activity, /APP_ORIGIN\s*=\s*"https:\/\/appassets\.androidplatform\.net"/);

  for (const name of [
    'platform', 'versionName', 'commit',
    'hasMicrophonePermission', 'requestMicrophonePermission',
    'startNativeRecording', 'stopNativeRecording', 'nativeRecordingSize',
    'nativeRecordingChunkBase64', 'nativeRecordingLastError', 'clearNativeRecording',
    'pendingImportSize', 'pendingImportName', 'pendingImportMime', 'pendingImportChunkBase64', 'clearPendingImport',
    'beginSave', 'appendBase64', 'finishSave', 'abortSave', 'saveDataUrl', 'toast',
  ]) assertJavascriptMethod(name);
});

test('Android permission handling grants only local audio capture and reports microphone result back to web runtime', () => {
  const permissionRequest = methodBody('onPermissionRequest');
  assert.match(permissionRequest, /!isLocal\(request\.getOrigin\(\)\)/);
  assert.match(permissionRequest, /request\.deny\(\)/);
  assert.match(permissionRequest, /PermissionRequest\.RESOURCE_AUDIO_CAPTURE/);
  assert.match(permissionRequest, /request\.grant\(new String\[\]\{PermissionRequest\.RESOURCE_AUDIO_CAPTURE\}\)/);
  assert.match(permissionRequest, /requestPermissions\(new String\[\]\{Manifest\.permission\.RECORD_AUDIO\},\s*REQUEST_MICROPHONE\)/);

  const requestPermission = methodBody('requestMicrophonePermission');
  assert.match(requestPermission, /if \(hasMicrophonePermission\(\)\) activity\.notifyMicrophonePermission\(true\)/);
  assert.match(requestPermission, /activity\.requestPermissions\(new String\[\]\{Manifest\.permission\.RECORD_AUDIO\},\s*REQUEST_MICROPHONE\)/);

  const notify = methodBody('notifyMicrophonePermission');
  assert.match(notify, /PabloVoiceOnMicPermission/);
  assert.match(activity, /REQUEST_MICROPHONE/);
});

test('Native recording bridge fails closed, writes a WAV file and streams bounded chunks to JavaScript', () => {
  const start = methodBody('startNativeRecording');
  assert.match(start, /if \(!hasMicrophonePermission\(\)\) \{ recordingError = "PERMISSION"; return false; \}/);
  assert.match(start, /clearNativeRecording\(\)/);
  assert.match(start, /new int\[\]\{48000, 44100, 32000, 16000\}/);
  assert.match(start, /new int\[\]\{MediaRecorder\.AudioSource\.MIC, MediaRecorder\.AudioSource\.VOICE_RECOGNITION\}/);
  assert.match(start, /File\.createTempFile\("pv-record-",\s*"\.wav"/);
  assert.match(start, /output\.write\(new byte\[44\]\)/);
  assert.match(start, /audioRecord\.startRecording\(\)/);
  assert.match(start, /recordingThread = new Thread\(\(\) -> recordPcm\(readSize\),\s*"PabloVoice-AudioRecord"\)/);

  const stop = methodBody('stopNativeRecording');
  assert.match(stop, /if \(audioRecord == null\) \{ recordingError = "AUDIORECORD_NOT_RUNNING"; return false; \}/);
  assert.match(stop, /thread\.join\(2000\)/);
  assert.match(stop, /audioRecord\.release\(\)/);
  assert.match(stop, /recordingFile\.length\(\) <= 44/);
  assert.match(stop, /patchWavHeader\(recordingFile, recordingSampleRate, 1, 16\)/);

  const chunk = methodBody('fileChunk');
  assert.match(chunk, /offset < 0 \|\| length <= 0/);
  assert.match(chunk, /Math\.min\(length, 64 \* 1024\)/);
  assert.match(chunk, /random\.seek\(offset\)/);
  assert.match(chunk, /Base64\.encodeToString\(data, android\.util\.Base64\.NO_WRAP\)/);

  const clear = methodBody('clearNativeRecording');
  assert.match(clear, /recordingActive = false/);
  assert.match(clear, /audioRecord\.stop\(\)/);
  assert.match(clear, /audioRecord\.release\(\)/);
  assert.match(clear, /thread\.join\(500\)/);
  assert.match(clear, /recordingFile\.delete\(\)/);
});

test('Android open-with import is bounded, temporary and consumed through the pending-import bridge', () => {
  const queue = methodBody('queueIncomingIntent');
  assert.match(queue, /Intent\.ACTION_VIEW/);
  assert.match(queue, /Intent\.ACTION_SEND/);
  assert.match(queue, /Intent\.EXTRA_STREAM/);
  assert.match(queue, /MAX_IMPORT_BYTES/);
  assert.match(queue, /FILE_TOO_LARGE/);
  assert.match(queue, /EMPTY_FILE/);
  assert.match(queue, /bridge\.setPendingImport\(target, name, mime\)/);
  assert.match(queue, /notifyPendingImport/);

  const setPending = methodBody('setPendingImport');
  assert.match(setPending, /clearPendingImport\(\)/);
  assert.match(setPending, /pendingImportName = sanitize\(name\)/);
  assert.match(setPending, /pendingImportMime = mime == null \|\| mime\.isBlank\(\) \? "application\/octet-stream" : mime/);

  const clearPending = methodBody('clearPendingImport');
  assert.match(clearPending, /pendingImportFile\.delete\(\)/);
  assert.match(clearPending, /pendingImportName = ""/);
  assert.match(clearPending, /pendingImportMime = "application\/octet-stream"/);
});

test('Android export bridge writes bounded temp files, aborts safely and saves to Downloads/PabloVoice', () => {
  const begin = methodBody('beginSave');
  assert.match(begin, /abortSave\(\)/);
  assert.match(begin, /exportName = sanitize\(requestedName\)/);
  assert.match(begin, /File\.createTempFile\("pv-export-",\s*"\.part"/);
  assert.match(begin, /new FileOutputStream\(exportFile\)/);

  const append = methodBody('appendBase64');
  assert.match(append, /exportOutput == null \|\| chunk == null/);
  assert.match(append, /Base64\.decode\(chunk, android\.util\.Base64\.DEFAULT\)/);
  assert.match(append, /abortSave\(\)/);

  const finish = methodBody('finishSave');
  assert.match(finish, /exportOutput\.flush\(\)/);
  assert.match(finish, /saveFile\(activity, exportFile, exportName, exportMime\)/);
  assert.match(finish, /exportFile\.delete\(\)/);
  assert.match(finish, /Salvo em Downloads\/PabloVoice/);

  const abort = methodBody('abortSave');
  assert.match(abort, /exportOutput\.close\(\)/);
  assert.match(abort, /exportFile\.delete\(\)/);

  const save = methodBody('saveFile');
  assert.match(save, /MediaStore\.Downloads\.getContentUri\(MediaStore\.VOLUME_EXTERNAL_PRIMARY\)/);
  assert.match(save, /Environment\.DIRECTORY_DOWNLOADS \+ "\/PabloVoice"/);
  assert.match(save, /MediaStore\.Downloads\.IS_PENDING, 1/);
  assert.match(save, /MediaStore\.Downloads\.IS_PENDING, 0/);
  assert.match(save, /getExternalFilesDir\(Environment\.DIRECTORY_DOWNLOADS\)/);
});

test('Android filename and URL handling avoid unsafe paths and external appassets escalation', () => {
  const sanitize = methodBody('sanitize');
  assert.match(sanitize, /PabloVoice\.wav/);
  assert.match(sanitize, /replaceAll\("\[\\\\\\\\\/:\*\?\\\"<>\|\\\\p\{Cntrl\}\]"/);
  assert.match(sanitize, /clean\.length\(\) > 120 \? clean\.substring\(0, 120\) : clean/);

  const override = methodBody('shouldOverrideUrlLoading');
  assert.match(override, /if \(isLocal\(uri\)\) return false/);
  assert.match(override, /Intent\.ACTION_VIEW/);
  assert.match(override, /return true/);

  const local = methodBody('isLocal');
  assert.match(local, /"https"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/);
  assert.match(local, /"appassets\.androidplatform\.net"\.equalsIgnoreCase\(uri\.getHost\(\)\)/);
});

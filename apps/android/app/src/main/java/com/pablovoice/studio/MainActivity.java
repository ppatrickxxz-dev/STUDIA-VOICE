package com.pablovoice.studio;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = APP_ORIGIN + "/assets/index.html";
    private static final int REQUEST_FILE_CHOOSER = 4101;
    private static final int REQUEST_MICROPHONE = 4102;
    private static final long MAX_IMPORT_BYTES = 300L * 1024L * 1024L;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingAudioPermissionRequest;
    private WebViewAssetLoader assetLoader;
    private NativeBridge bridge;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(7, 8, 13));
        getWindow().setNavigationBarColor(Color.rgb(7, 8, 13));
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        bridge = new NativeBridge(this);
        createWebView();
        if (state == null || webView.restoreState(state) == null) webView.loadUrl(START_URL);
        queueIncomingIntent(getIntent());
    }

    private void createWebView() {
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.rgb(7, 8, 13));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PabloVoiceAndroid/" + BuildConfig.VERSION_NAME);

        webView.addJavascriptInterface(bridge, "PabloVoiceAndroid");
        webView.setWebViewClient(new LocalClient());
        webView.setWebChromeClient(new LocalChromeClient());
        webView.setDownloadListener(new LocalDownloadListener());
        installPullToRefresh();
    }

    private boolean isLocal(Uri uri) {
        return uri != null
                && "https".equalsIgnoreCase(uri.getScheme())
                && "appassets.androidplatform.net".equalsIgnoreCase(uri.getHost());
    }

    private void installPullToRefresh() {
        final float[] startY = new float[1];
        final boolean[] top = new boolean[1];
        webView.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                startY[0] = event.getY();
                top[0] = webView.getScrollY() <= 0;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_UP && top[0] && event.getY() - startY[0] > 260f) {
                webView.reload();
                Toast.makeText(this, "Atualizando o estúdio…", Toast.LENGTH_SHORT).show();
            }
            return false;
        });
    }

    private class LocalClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isLocal(uri)) return false;
            if ("https".equalsIgnoreCase(uri.getScheme())) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (Exception ignored) { Toast.makeText(MainActivity.this, "Não consegui abrir esse link.", Toast.LENGTH_SHORT).show(); }
            }
            return true;
        }

        @Override public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (isLocal(Uri.parse(url))) notifyPendingImport();
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !isLocal(request.getUrl())) view.loadUrl(START_URL);
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            try {
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
            } catch (Exception ignored) { }
            webView = null;
            createWebView();
            webView.loadUrl(START_URL);
            Toast.makeText(MainActivity.this, "O Studio foi recuperado após uma falha de renderização.", Toast.LENGTH_LONG).show();
            return true;
        }
    }

    private class LocalChromeClient extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            Intent intent;
            try {
                intent = params.createIntent();
                intent.setType("audio/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
            } catch (Exception error) {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("audio/*");
            }
            try {
                startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                return true;
            } catch (Exception error) {
                filePathCallback = null;
                Toast.makeText(MainActivity.this, "Não encontrei um seletor de arquivos.", Toast.LENGTH_SHORT).show();
                return false;
            }
        }

        @Override public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!isLocal(request.getOrigin())) { request.deny(); return; }
                boolean audio = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                if (!audio) { request.deny(); return; }
                if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    if (pendingAudioPermissionRequest != null) pendingAudioPermissionRequest.deny();
                    pendingAudioPermissionRequest = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MICROPHONE);
                }
            });
        }

        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingAudioPermissionRequest == request) pendingAudioPermissionRequest = null;
        }
    }

    private class LocalDownloadListener implements DownloadListener {
        @Override public void onDownloadStart(String url, String userAgent, String disposition, String mime, long length) {
            String name = sanitize(android.webkit.URLUtil.guessFileName(url, disposition, mime));
            if (url != null && url.startsWith("blob:")) { requestBlob(url, name); return; }
            if (url != null && url.startsWith("data:")) { bridge.saveDataUrl(url, name); return; }
            Toast.makeText(MainActivity.this, "Use Exportar dentro do PabloVoice.", Toast.LENGTH_SHORT).show();
        }
    }

    private void requestBlob(String blobUrl, String fileName) {
        String javascript = "(async()=>{try{const b=await(await fetch(" + JSONObject.quote(blobUrl)
                + ")).blob();const r=new FileReader();r.onloadend=()=>PabloVoiceAndroid.saveDataUrl(r.result,"
                + JSONObject.quote(fileName) + ");r.readAsDataURL(b)}catch(e){console.error(e)}})();";
        webView.evaluateJavascript(javascript, null);
    }

    private void notifyMicrophonePermission(boolean granted) {
        if (webView == null) return;
        webView.evaluateJavascript("window.PabloVoiceOnMicPermission&&window.PabloVoiceOnMicPermission(" + granted + ");", null);
    }

    private void notifyPendingImport() {
        if (webView == null || bridge.pendingImportSize() <= 0) return;
        webView.evaluateJavascript("window.PabloVoiceConsumeAndroidImport&&window.PabloVoiceConsumeAndroidImport();", null);
    }

    private void queueIncomingIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            if (Build.VERSION.SDK_INT >= 33) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            else {
                @SuppressWarnings("deprecation") Uri legacy = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                uri = legacy;
            }
        }
        if (uri == null) return;
        final Uri incoming = uri;
        new Thread(() -> {
            try {
                String mime = getContentResolver().getType(incoming);
                String name = displayName(incoming);
                File target = File.createTempFile("pv-open-with-", extensionFor(name), getCacheDir());
                long total = 0;
                try (InputStream input = getContentResolver().openInputStream(incoming); FileOutputStream output = new FileOutputStream(target)) {
                    if (input == null) throw new IllegalStateException("INPUT_UNAVAILABLE");
                    byte[] buffer = new byte[131072];
                    int count;
                    while ((count = input.read(buffer)) > 0) {
                        total += count;
                        if (total > MAX_IMPORT_BYTES) throw new IllegalArgumentException("FILE_TOO_LARGE");
                        output.write(buffer, 0, count);
                    }
                }
                if (total <= 0) throw new IllegalArgumentException("EMPTY_FILE");
                bridge.setPendingImport(target, name, mime);
                runOnUiThread(this::notifyPendingImport);
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "Não consegui abrir o áudio compartilhado.", Toast.LENGTH_LONG).show());
            }
        }, "PabloVoice-OpenWith").start();
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return sanitize(cursor.getString(0));
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return sanitize(last == null ? "audio-importado" : last);
    }

    private static String extensionFor(String name) {
        int dot = name == null ? -1 : name.lastIndexOf('.');
        if (dot < 0 || dot < name.length() - 8) return ".audio";
        return name.substring(dot);
    }

    public static class NativeBridge {
        private final MainActivity activity;
        private File exportFile;
        private FileOutputStream exportOutput;
        private String exportName;
        private String exportMime;
        private AudioRecord audioRecord;
        private Thread recordingThread;
        private volatile boolean recordingActive;
        private File recordingFile;
        private String recordingError = "";
        private int recordingSampleRate = 44100;
        private File pendingImportFile;
        private String pendingImportName = "";
        private String pendingImportMime = "application/octet-stream";

        NativeBridge(MainActivity activity) { this.activity = activity; }

        @JavascriptInterface public String platform() { return "android"; }
        @JavascriptInterface public String versionName() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public String commit() { return BuildConfig.PV_COMMIT; }
        @JavascriptInterface public boolean hasMicrophonePermission() {
            return Build.VERSION.SDK_INT < 23 || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface public void requestMicrophonePermission() {
            activity.runOnUiThread(() -> {
                if (hasMicrophonePermission()) activity.notifyMicrophonePermission(true);
                else activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MICROPHONE);
            });
        }

        @JavascriptInterface public synchronized boolean startNativeRecording() {
            recordingError = "";
            if (!hasMicrophonePermission()) { recordingError = "PERMISSION"; return false; }
            clearNativeRecording();
            final int channel = AudioFormat.CHANNEL_IN_MONO;
            final int format = AudioFormat.ENCODING_PCM_16BIT;
            final int[] sampleRates = new int[]{48000, 44100, 32000, 16000};
            final int[] sources = new int[]{MediaRecorder.AudioSource.MIC, MediaRecorder.AudioSource.VOICE_RECOGNITION};
            try {
                AudioRecord chosen = null;
                int chosenRate = 0;
                int chosenBuffer = 0;
                for (int source : sources) {
                    for (int rate : sampleRates) {
                        int minimum = AudioRecord.getMinBufferSize(rate, channel, format);
                        if (minimum <= 0) continue;
                        int buffer = Math.max(minimum * 2, rate / 5);
                        AudioRecord candidate = null;
                        try {
                            candidate = new AudioRecord(source, rate, channel, format, buffer);
                            if (candidate.getState() == AudioRecord.STATE_INITIALIZED) {
                                chosen = candidate; chosenRate = rate; chosenBuffer = buffer; break;
                            }
                        } catch (Exception ignored) { }
                        try { if (candidate != null) candidate.release(); } catch (Exception ignored) { }
                    }
                    if (chosen != null) break;
                }
                if (chosen == null) { recordingError = "AUDIORECORD_INIT"; return false; }
                recordingSampleRate = chosenRate;
                recordingFile = File.createTempFile("pv-record-", ".wav", activity.getCacheDir());
                try (FileOutputStream output = new FileOutputStream(recordingFile)) { output.write(new byte[44]); }
                audioRecord = chosen;
                final int readSize = Math.max(4096, chosenBuffer);
                audioRecord.startRecording();
                if (audioRecord.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                    recordingError = "AUDIORECORD_START";
                    audioRecord.release(); audioRecord = null; recordingFile.delete(); recordingFile = null;
                    return false;
                }
                recordingActive = true;
                recordingThread = new Thread(() -> recordPcm(readSize), "PabloVoice-AudioRecord");
                recordingThread.start();
                return true;
            } catch (Exception error) {
                recordingError = "AUDIORECORD_EXCEPTION_" + error.getClass().getSimpleName();
                clearNativeRecording();
                return false;
            }
        }

        private void recordPcm(int readSize) {
            byte[] buffer = new byte[readSize];
            try (FileOutputStream output = new FileOutputStream(recordingFile, true)) {
                while (recordingActive) {
                    AudioRecord current = audioRecord;
                    if (current == null) break;
                    int count = current.read(buffer, 0, buffer.length);
                    if (count > 0) output.write(buffer, 0, count);
                    else if (count == AudioRecord.ERROR_DEAD_OBJECT || count == AudioRecord.ERROR_INVALID_OPERATION) {
                        recordingError = "AUDIORECORD_READ_" + count;
                        break;
                    }
                }
                output.flush();
            } catch (Exception error) {
                recordingError = "AUDIORECORD_IO_" + error.getClass().getSimpleName();
            }
        }

        @JavascriptInterface public synchronized boolean stopNativeRecording() {
            if (audioRecord == null) { recordingError = "AUDIORECORD_NOT_RUNNING"; return false; }
            recordingActive = false;
            try { audioRecord.stop(); } catch (Exception ignored) { }
            Thread thread = recordingThread;
            if (thread != null) try { thread.join(2000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            try { audioRecord.release(); } catch (Exception ignored) { }
            audioRecord = null; recordingThread = null;
            if (recordingFile == null || !recordingFile.isFile() || recordingFile.length() <= 44) {
                if (recordingError.isEmpty()) recordingError = "AUDIORECORD_EMPTY";
                return false;
            }
            try { patchWavHeader(recordingFile, recordingSampleRate, 1, 16); return true; }
            catch (Exception error) { recordingError = "WAV_HEADER_" + error.getClass().getSimpleName(); return false; }
        }

        @JavascriptInterface public synchronized int nativeRecordingSize() {
            return recordingFile == null || !recordingFile.isFile() ? 0 : (int) Math.min(Integer.MAX_VALUE, recordingFile.length());
        }

        @JavascriptInterface public synchronized String nativeRecordingChunkBase64(int offset, int length) {
            return fileChunk(recordingFile, offset, length, true);
        }

        @JavascriptInterface public synchronized String nativeRecordingLastError() { return recordingError == null ? "" : recordingError; }

        @JavascriptInterface public synchronized void clearNativeRecording() {
            recordingActive = false;
            if (audioRecord != null) {
                try { audioRecord.stop(); } catch (Exception ignored) { }
                try { audioRecord.release(); } catch (Exception ignored) { }
                audioRecord = null;
            }
            Thread thread = recordingThread; recordingThread = null;
            if (thread != null && thread != Thread.currentThread()) {
                try { thread.join(500); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            }
            if (recordingFile != null) { recordingFile.delete(); recordingFile = null; }
        }

        synchronized void setPendingImport(File file, String name, String mime) {
            clearPendingImport();
            pendingImportFile = file;
            pendingImportName = sanitize(name);
            pendingImportMime = mime == null || mime.isBlank() ? "application/octet-stream" : mime;
        }

        @JavascriptInterface public synchronized int pendingImportSize() {
            return pendingImportFile == null || !pendingImportFile.isFile() ? 0 : (int) Math.min(Integer.MAX_VALUE, pendingImportFile.length());
        }
        @JavascriptInterface public synchronized String pendingImportName() { return pendingImportName; }
        @JavascriptInterface public synchronized String pendingImportMime() { return pendingImportMime; }
        @JavascriptInterface public synchronized String pendingImportChunkBase64(int offset, int length) { return fileChunk(pendingImportFile, offset, length, false); }
        @JavascriptInterface public synchronized void clearPendingImport() {
            if (pendingImportFile != null) pendingImportFile.delete();
            pendingImportFile = null; pendingImportName = ""; pendingImportMime = "application/octet-stream";
        }

        private String fileChunk(File file, int offset, int length, boolean recording) {
            if (file == null || !file.isFile() || offset < 0 || length <= 0) return "";
            int safe = Math.min(length, 64 * 1024);
            try (java.io.RandomAccessFile random = new java.io.RandomAccessFile(file, "r")) {
                if (offset >= random.length()) return "";
                random.seek(offset);
                byte[] data = new byte[(int) Math.min(safe, random.length() - offset)];
                int count = random.read(data);
                if (count <= 0) return "";
                if (count != data.length) data = Arrays.copyOf(data, count);
                return android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
            } catch (Exception error) {
                if (recording) recordingError = "CHUNK_" + error.getClass().getSimpleName();
                return "";
            }
        }

        @JavascriptInterface public void toast(String text) {
            activity.runOnUiThread(() -> Toast.makeText(activity, text == null ? "" : text, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface public synchronized boolean beginSave(String requestedName, String mime) {
            try {
                abortSave();
                exportName = sanitize(requestedName);
                exportMime = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                exportFile = File.createTempFile("pv-export-", ".part", activity.getCacheDir());
                exportOutput = new FileOutputStream(exportFile);
                return true;
            } catch (Exception error) { abortSave(); return false; }
        }

        @JavascriptInterface public synchronized boolean appendBase64(String chunk) {
            if (exportOutput == null || chunk == null) return false;
            try { exportOutput.write(android.util.Base64.decode(chunk, android.util.Base64.DEFAULT)); return true; }
            catch (Exception error) { abortSave(); return false; }
        }

        @JavascriptInterface public synchronized boolean finishSave() {
            if (exportOutput == null || exportFile == null) return false;
            try {
                exportOutput.flush(); exportOutput.close(); exportOutput = null;
                saveFile(activity, exportFile, exportName, exportMime);
                exportFile.delete();
                final String name = exportName;
                exportFile = null; exportName = null; exportMime = null;
                activity.runOnUiThread(() -> Toast.makeText(activity, "Salvo em Downloads/PabloVoice: " + name, Toast.LENGTH_LONG).show());
                return true;
            } catch (Exception error) { abortSave(); return false; }
        }

        @JavascriptInterface public synchronized void abortSave() {
            try { if (exportOutput != null) exportOutput.close(); } catch (Exception ignored) { }
            exportOutput = null;
            if (exportFile != null) exportFile.delete();
            exportFile = null; exportName = null; exportMime = null;
        }

        @JavascriptInterface public void saveDataUrl(String dataUrl, String requestedName) {
            if (dataUrl == null || !dataUrl.startsWith("data:")) return;
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 6) throw new IllegalArgumentException();
                String header = dataUrl.substring(5, comma), body = dataUrl.substring(comma + 1);
                boolean base64 = header.toLowerCase(Locale.ROOT).contains(";base64");
                String mime = header.split(";", 2)[0];
                if (mime.isEmpty()) mime = "application/octet-stream";
                byte[] bytes = base64 ? android.util.Base64.decode(body, android.util.Base64.DEFAULT) : Uri.decode(body).getBytes(StandardCharsets.UTF_8);
                File temporary = File.createTempFile("pv-data-", ".part", activity.getCacheDir());
                try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(bytes); }
                saveFile(activity, temporary, sanitize(requestedName), mime);
                temporary.delete();
            } catch (Exception error) {
                activity.runOnUiThread(() -> Toast.makeText(activity, "Não consegui salvar o arquivo.", Toast.LENGTH_SHORT).show());
            }
        }

        private void patchWavHeader(File file, int sampleRate, int channels, int bitsPerSample) throws Exception {
            long dataLengthLong = Math.max(0, file.length() - 44);
            int dataLength = (int) Math.min(0x7fffffffL, dataLengthLong);
            int byteRate = sampleRate * channels * bitsPerSample / 8;
            int blockAlign = channels * bitsPerSample / 8;
            try (java.io.RandomAccessFile random = new java.io.RandomAccessFile(file, "rw")) {
                random.seek(0); random.writeBytes("RIFF"); writeLe32(random, 36 + dataLength); random.writeBytes("WAVE");
                random.writeBytes("fmt "); writeLe32(random, 16); writeLe16(random, 1); writeLe16(random, channels);
                writeLe32(random, sampleRate); writeLe32(random, byteRate); writeLe16(random, blockAlign); writeLe16(random, bitsPerSample);
                random.writeBytes("data"); writeLe32(random, dataLength);
            }
        }

        private void writeLe16(java.io.RandomAccessFile random, int value) throws Exception {
            random.write(value & 0xff); random.write((value >>> 8) & 0xff);
        }
        private void writeLe32(java.io.RandomAccessFile random, int value) throws Exception {
            random.write(value & 0xff); random.write((value >>> 8) & 0xff); random.write((value >>> 16) & 0xff); random.write((value >>> 24) & 0xff);
        }
    }

    private static void saveFile(Context context, File source, String fileName, String mime) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PabloVoice");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri item = context.getContentResolver().insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            if (item == null) throw new IllegalStateException("MEDIASTORE_INSERT");
            try (FileInputStream input = new FileInputStream(source); OutputStream output = context.getContentResolver().openOutputStream(item)) {
                if (output == null) throw new IllegalStateException("MEDIASTORE_OUTPUT");
                copy(input, output);
            } catch (Exception error) {
                context.getContentResolver().delete(item, null, null);
                throw error;
            }
            values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0); context.getContentResolver().update(item, values, null, null);
        } else {
            File directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (directory == null) throw new IllegalStateException("DOWNLOAD_DIRECTORY");
            try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(new File(directory, fileName))) { copy(input, output); }
        }
    }

    private static void copy(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[131072]; int count;
        while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
    }

    private static String sanitize(String value) {
        if (value == null || value.trim().isEmpty()) return "PabloVoice.wav";
        String clean = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return clean.length() > 120 ? clean.substring(0, 120) : clean;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        queueIncomingIntent(intent);
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQUEST_FILE_CHOOSER || filePathCallback == null) return;
        Uri[] values = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                values = new Uri[count];
                for (int index = 0; index < count; index++) values[index] = data.getClipData().getItemAt(index).getUri();
            } else if (data.getData() != null) values = new Uri[]{data.getData()};
        }
        filePathCallback.onReceiveValue(values);
        filePathCallback = null;
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != REQUEST_MICROPHONE) return;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        PermissionRequest request = pendingAudioPermissionRequest;
        pendingAudioPermissionRequest = null;
        if (request != null) {
            if (granted) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else request.deny();
        } else notifyMicrophonePermission(granted);
        if (!granted) Toast.makeText(this, "Microfone não autorizado.", Toast.LENGTH_SHORT).show();
    }

    @Override protected void onSaveInstanceState(Bundle output) {
        if (webView != null) webView.saveState(output);
        super.onSaveInstanceState(output);
    }
    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); }
    @Override protected void onPause() { if (webView != null) webView.onPause(); super.onPause(); }
    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }

    @Override protected void onDestroy() {
        bridge.clearNativeRecording();
        bridge.clearPendingImport();
        bridge.abortSave();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.removeJavascriptInterface("PabloVoiceAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}


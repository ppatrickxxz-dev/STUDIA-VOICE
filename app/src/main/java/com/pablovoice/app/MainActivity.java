package com.pablovoice.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.URI;
import java.util.Arrays;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQUEST_FILE_CHOOSER = 4001;
    private static final int REQUEST_MICROPHONE = 4002;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingAudioPermissionRequest;
    private String trustedHost;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        trustedHost = safeHost(BuildConfig.PABLOVOICE_URL);
        configureSystemBars();
        createWebView();

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(BuildConfig.PABLOVOICE_URL);
        }
    }

    private void configureSystemBars() {
        getWindow().setStatusBarColor(Color.rgb(8, 9, 15));
        getWindow().setNavigationBarColor(Color.rgb(8, 9, 15));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(0);
        }
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.rgb(8, 9, 15));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PabloVoiceAndroid/1.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new DownloadBridge(this), "PabloVoiceAndroid");
        webView.setWebViewClient(new PabloVoiceWebViewClient());
        webView.setWebChromeClient(new PabloVoiceWebChromeClient());
        webView.setDownloadListener(new PabloVoiceDownloadListener());
        installPullToRefreshGesture();
    }

    private void installPullToRefreshGesture() {
        final float[] startY = new float[1];
        final boolean[] startedAtTop = new boolean[1];
        webView.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                startY[0] = event.getY();
                startedAtTop[0] = webView.getScrollY() <= 0;
            } else if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                float distance = event.getY() - startY[0];
                if (startedAtTop[0] && distance > 220f) {
                    webView.reload();
                    Toast.makeText(MainActivity.this, "Atualizando o estúdio…", Toast.LENGTH_SHORT).show();
                }
            }
            return false;
        });
    }

    private boolean isTrusted(Uri uri) {
        if (uri == null || trustedHost == null) return false;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return "https".equalsIgnoreCase(scheme) && host != null && host.equalsIgnoreCase(trustedHost);
    }

    private String safeHost(String url) {
        try {
            return URI.create(url).getHost();
        } catch (Exception ignored) {
            return null;
        }
    }

    private class PabloVoiceWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isTrusted(uri)) return false;

            try {
                Intent external = new Intent(Intent.ACTION_VIEW, uri);
                startActivity(external);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Não foi possível abrir este link.", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isTrusted(uri)) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Não foi possível abrir este link.", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showOfflinePage();
            }
        }
    }

    private class PabloVoiceWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams) {

            if (MainActivity.this.filePathCallback != null) {
                MainActivity.this.filePathCallback.onReceiveValue(null);
            }
            MainActivity.this.filePathCallback = filePathCallback;

            Intent intent;
            try {
                intent = fileChooserParams.createIntent();
            } catch (Exception e) {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("audio/*");
            }

            try {
                startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                return true;
            } catch (Exception e) {
                MainActivity.this.filePathCallback = null;
                Toast.makeText(MainActivity.this, "Nenhum seletor de arquivo disponível.", Toast.LENGTH_SHORT).show();
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!isTrusted(request.getOrigin())) {
                    request.deny();
                    return;
                }

                boolean asksForAudio = Arrays.asList(request.getResources())
                        .contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                if (!asksForAudio) {
                    request.deny();
                    return;
                }

                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    if (pendingAudioPermissionRequest != null) {
                        pendingAudioPermissionRequest.deny();
                    }
                    pendingAudioPermissionRequest = request;
                    requestPermissions(
                            new String[]{Manifest.permission.RECORD_AUDIO},
                            REQUEST_MICROPHONE);
                }
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingAudioPermissionRequest == request) {
                pendingAudioPermissionRequest = null;
            }
        }
    }

    private class PabloVoiceDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(
                String url,
                String userAgent,
                String contentDisposition,
                String mimeType,
                long contentLength) {

            String fileName = sanitizeFileName(
                    URLUtil.guessFileName(url, contentDisposition, mimeType));

            if (url != null && url.startsWith("blob:")) {
                requestBlobDownload(url, fileName);
                return;
            }

            if (url != null && url.startsWith("data:")) {
                new DownloadBridge(MainActivity.this).saveDataUrl(url, fileName);
                return;
            }

            Uri uri = Uri.parse(url);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                Toast.makeText(MainActivity.this, "Download bloqueado: origem não segura.", Toast.LENGTH_SHORT).show();
                return;
            }

            try {
                DownloadManager.Request request = new DownloadManager.Request(uri);
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.setTitle(fileName);
                request.setDescription("Arquivo do PabloVoice");
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    request.setDestinationInExternalPublicDir(
                            Environment.DIRECTORY_DOWNLOADS,
                            "PabloVoice/" + fileName);
                } else {
                    request.setDestinationInExternalFilesDir(
                            MainActivity.this,
                            Environment.DIRECTORY_DOWNLOADS,
                            fileName);
                }

                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(MainActivity.this, "Baixando " + fileName, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Não foi possível baixar o arquivo.", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void requestBlobDownload(String blobUrl, String fileName) {
        String js = "(async function(){" +
                "try{" +
                "const r=await fetch(" + JSONObject.quote(blobUrl) + ");" +
                "const b=await r.blob();" +
                "const fr=new FileReader();" +
                "fr.onloadend=function(){window.PabloVoiceAndroid.saveDataUrl(fr.result," + JSONObject.quote(fileName) + ");};" +
                "fr.readAsDataURL(b);" +
                "}catch(e){console.error('PabloVoice Android blob download failed',e);}" +
                "})();";
        webView.evaluateJavascript(js, null);
    }

    public static class DownloadBridge {
        private final Activity activity;

        DownloadBridge(Activity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void saveDataUrl(String dataUrl, String requestedFileName) {
            if (dataUrl == null || !dataUrl.startsWith("data:")) return;
            try {
                int comma = dataUrl.indexOf(',');
                if (comma <= 5) throw new IllegalArgumentException("Invalid data URL");

                String header = dataUrl.substring(5, comma);
                String body = dataUrl.substring(comma + 1);
                boolean base64 = header.toLowerCase(Locale.ROOT).contains(";base64");
                String mime = header.split(";", 2)[0];
                if (mime.isEmpty()) mime = "application/octet-stream";

                byte[] bytes = base64
                        ? android.util.Base64.decode(body, android.util.Base64.DEFAULT)
                        : Uri.decode(body).getBytes(java.nio.charset.StandardCharsets.UTF_8);

                String fileName = sanitizeFileName(requestedFileName);
                saveBytes(activity, bytes, fileName, mime);
                activity.runOnUiThread(() -> Toast.makeText(
                        activity,
                        "Salvo em Downloads/PabloVoice: " + fileName,
                        Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                activity.runOnUiThread(() -> Toast.makeText(
                        activity,
                        "Não foi possível salvar o arquivo gerado.",
                        Toast.LENGTH_SHORT).show());
            }
        }
    }

    private static void saveBytes(Context context, byte[] bytes, String fileName, String mimeType) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PabloVoice");
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri item = context.getContentResolver().insert(collection, values);
            if (item == null) throw new IllegalStateException("Unable to create MediaStore item");

            try (OutputStream out = context.getContentResolver().openOutputStream(item)) {
                if (out == null) throw new IllegalStateException("Unable to open output stream");
                out.write(bytes);
            }

            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            context.getContentResolver().update(item, values, null, null);
        } else {
            File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) throw new IllegalStateException("Downloads directory unavailable");
            File target = new File(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(target)) {
                out.write(bytes);
            }
        }
    }

    private static String sanitizeFileName(String value) {
        String fallback = "pablovoice-download";
        if (value == null || value.trim().isEmpty()) return fallback;
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (cleaned.isEmpty()) return fallback;
        return cleaned.length() > 120 ? cleaned.substring(0, 120) : cleaned;
    }

    private void showOfflinePage() {
        String safeUrl = BuildConfig.PABLOVOICE_URL.replace("'", "%27");
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>" +
                "<style>body{margin:0;background:#08090f;color:#fff;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center}" +
                ".box{padding:28px;max-width:420px}button{border:0;border-radius:14px;padding:14px 20px;font-size:16px}</style></head>" +
                "<body><div class='box'><h2>PabloVoice</h2><p>Não consegui conectar ao estúdio.</p>" +
                "<button onclick=\"location.href='" + safeUrl + "'\">Tentar de novo</button></div></body></html>";
        webView.loadDataWithBaseURL(BuildConfig.PABLOVOICE_URL, html, "text/html", "UTF-8", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILE_CHOOSER || filePathCallback == null) return;

        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                result = new Uri[count];
                for (int i = 0; i < count; i++) {
                    result[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }

        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_MICROPHONE || pendingAudioPermissionRequest == null) return;

        PermissionRequest request = pendingAudioPermissionRequest;
        pendingAudioPermissionRequest = null;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
            Toast.makeText(this, "Microfone não autorizado.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.removeJavascriptInterface("PabloVoiceAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

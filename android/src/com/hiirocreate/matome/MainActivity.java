package com.hiirocreate.matome;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * public/ の Web アプリを WebView で表示するだけのシェル。
 * 掲示板・Claude API への通信 (CORS 回避と Shift_JIS 変換) と読み上げ (WebView は Web Speech API 非対応) を JS に提供する。
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.local";
    // スマホ UA だとスマホ版 (itest, JS 描画でレスが HTML に無い) へ転送されることがあるため PC 版の UA を使う
    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    InputStream in = getAssets().open("www" + path);
                    return new WebResourceResponse(mime(path), "utf-8", in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u)); // 元スレ等は外部ブラウザで開く
                return true;
            }
        });

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status == TextToSpeech.SUCCESS) {
                    tts.setLanguage(Locale.JAPAN);
                    ttsReady = true;
                }
            }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { js("window.__ttsDone && window.__ttsDone(" + JSONObject.quote(id) + ")"); }
            @Override public void onError(String id) { onDone(id); }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/index.html");
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        return "application/octet-stream";
    }

    private void js(final String code) {
        web.post(new Runnable() {
            @Override public void run() { web.evaluateJavascript(code, null); }
        });
    }

    private final Handler ui = new Handler(Looper.getMainLooper());

    private void deliver(int id, int status, String text) {
        byte[] data = text.getBytes(Charset.forName("UTF-8"));
        js("window.__bridgeCb(" + id + "," + status + ",'" + Base64.encodeToString(data, Base64.NO_WRAP) + "')");
    }

    /**
     * 画面に出さない WebView でページを開き、JS 実行後の内容を返す。
     * 通常の HTTP 取得がボット対策 (Cloudflare 等) やスマホ版転送で弾かれる場合の最終手段。
     */
    private void browse(final int id, final String url) {
        final WebView w = new WebView(this);
        w.getSettings().setJavaScriptEnabled(true);
        w.getSettings().setDomStorageEnabled(true);
        w.getSettings().setUserAgentString(UA);
        w.getSettings().setBlockNetworkImage(true);
        final boolean[] done = {false};
        final Runnable[] grab = new Runnable[1];
        final long started = System.currentTimeMillis();
        final Runnable finish = new Runnable() {
            @Override public void run() {
                if (done[0]) return;
                done[0] = true;
                w.stopLoading();
                w.destroy();
            }
        };
        grab[0] = new Runnable() {
            @Override public void run() {
                if (done[0]) return;
                w.evaluateJavascript(
                    "(function(){var t=document.title||'';var plain=(document.contentType||'').indexOf('text/plain')===0;" +
                    "return JSON.stringify([t, plain ? document.body.innerText : document.documentElement.outerHTML]);})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String v) {
                            if (done[0]) return;
                            try {
                                JSONArray a = new JSONArray(new org.json.JSONTokener(v).nextValue().toString());
                                String title = a.getString(0);
                                boolean challenge = title.contains("Just a moment") || title.contains("しばらくお待ち") || title.contains("Attention Required");
                                if (challenge && System.currentTimeMillis() - started < 20000) {
                                    ui.postDelayed(grab[0], 1500); // チャレンジ通過待ち
                                    return;
                                }
                                deliver(id, 200, a.getString(1));
                            } catch (Exception e) {
                                deliver(id, 0, "browse: " + e);
                            }
                            finish.run();
                        }
                    });
            }
        };
        w.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String u) {
                ui.removeCallbacks(grab[0]);
                ui.postDelayed(grab[0], 800);
            }
        });
        ui.postDelayed(new Runnable() {
            @Override public void run() {
                if (done[0]) return;
                deliver(id, 0, "browse: timeout");
                finish.run();
            }
        }, 30000);
        w.loadUrl(url);
    }

    class Bridge {
        @JavascriptInterface
        public void browse(final int id, final String url) {
            ui.post(new Runnable() {
                @Override public void run() { MainActivity.this.browse(id, url); }
            });
        }


        @JavascriptInterface
        public void request(final int id, final String method, final String url, final String headersJson, final String body) {
            pool.execute(new Runnable() { @Override public void run() {
                int status = 0;
                byte[] data;
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestMethod(method);
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(url.contains("api.anthropic.com") ? 600000 : 20000);
                    c.setRequestProperty("User-Agent", UA);
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                        String k = it.next();
                        c.setRequestProperty(k, h.getString(k));
                    }
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true);
                        c.getOutputStream().write(body.getBytes("UTF-8"));
                    }
                    status = c.getResponseCode();
                    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    if (in != null) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0 && out.size() < 8 * 1024 * 1024) out.write(buf, 0, n); // 巨大ページ対策
                        in.close();
                    }
                    data = out.toByteArray();
                } catch (Exception e) {
                    data = e.toString().getBytes(Charset.forName("UTF-8"));
                } finally {
                    if (c != null) c.disconnect();
                }
                // 生バイトを渡し、文字コード判定は JS 側 (lib/encoding.js) で行う
                js("window.__bridgeCb(" + id + "," + status + ",'" + Base64.encodeToString(data, Base64.NO_WRAP) + "')");
            }});
        }

        @JavascriptInterface
        public boolean speak(String id, String text, float pitch, float rate) {
            if (!ttsReady) return false;
            tts.setPitch(pitch);
            tts.setSpeechRate(rate);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
            return true;
        }

        @JavascriptInterface
        public void stopSpeak() {
            if (ttsReady) tts.stop();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (ttsReady) tts.stop();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        tts.shutdown();
        pool.shutdownNow();
        web.destroy();
        super.onDestroy();
    }
}

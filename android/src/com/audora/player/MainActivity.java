package com.audora.player;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Ecran unique : l'interface (HTML/CSS/JS dans assets/www) affichee dans une WebView,
 * reliee a la lecture (PlayerService) et a la synchro (SyncManager) via window.Android.
 */
public class MainActivity extends Activity implements PlayerService.Listener {
    private static final String HOST = "app.audora";
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#17121F"));
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost()); // aucune navigation hors de l'appli
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("https://" + HOST + "/index.html");

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        startService(new Intent(this, PlayerService.class)); // reprend la file d'attente sauvegardee
        SyncJobService.schedule(this, Library.get(this).getBool("background_sync", true));
    }

    /** Sert les fichiers de l'interface et les pochettes, sans serveur ni acces fichier direct. */
    private WebResourceResponse serve(Uri uri) {
        if (!HOST.equals(uri.getHost())) return null;
        String path = uri.getPath() == null ? "/" : uri.getPath();
        try {
            if (path.startsWith("/cover/")) {
                int id = Integer.parseInt(path.substring(7));
                File cover = Library.get(this).coverFile(id);
                if (!cover.exists()) return notFound();
                return new WebResourceResponse("image/jpeg", null, new FileInputStream(cover));
            }
            if (path.equals("/")) path = "/index.html";
            if (path.contains("..")) return notFound();
            InputStream in = getAssets().open("www" + path);
            return new WebResourceResponse(mime(path), "utf-8", in);
        } catch (Exception e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, null);
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    @Override
    protected void onResume() {
        super.onResume();
        PlayerService.listener = this;
        PlayerService service = PlayerService.instance;
        if (service != null) onPlayerState(service.state());
        emit("resume", "null");
    }

    @Override
    protected void onPause() {
        PlayerService.listener = null;
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        // L'interface gere le retour (fermer le lecteur, revenir a la page precedente) ; sinon on passe en arriere-plan.
        web.evaluateJavascript("window.onBack ? window.onBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    public void onPlayerState(JSONObject state) {
        emit("state", state.toString());
    }

    void emit(String event, String json) {
        runOnUiThread(() -> web.evaluateJavascript(
                "window.onNative && window.onNative(" + JSONObject.quote(event) + "," + json + ")", null));
    }

    private void command(String action, Intent extras) {
        Intent intent = new Intent(this, PlayerService.class).setAction(action);
        if (extras != null) intent.putExtras(extras);
        startService(intent);
    }

    /** Fonctions appelables depuis le JavaScript : window.Android.xxx(). */
    class Bridge {
        @JavascriptInterface
        public String library() {
            return Library.get(MainActivity.this).json();
        }

        @JavascriptInterface
        public String state() {
            PlayerService service = PlayerService.instance;
            return service != null ? service.state().toString() : "{}";
        }

        @JavascriptInterface
        public void play(String idsJson, int index, boolean shuffle) {
            try {
                JSONArray array = new JSONArray(idsJson);
                int[] ids = new int[array.length()];
                for (int i = 0; i < ids.length; i++) ids[i] = array.getInt(i);
                Intent extras = new Intent();
                extras.putExtra("ids", ids);
                extras.putExtra("index", index);
                extras.putExtra("shuffle", shuffle);
                MainActivity.this.command(PlayerService.ACTION_PLAY_QUEUE, extras);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void command(String name, int value) {
            Intent extras = new Intent();
            String action;
            switch (name) {
                case "toggle": action = PlayerService.ACTION_TOGGLE; break;
                case "next": action = PlayerService.ACTION_NEXT; break;
                case "prev": action = PlayerService.ACTION_PREV; break;
                case "shuffle": action = PlayerService.ACTION_SHUFFLE; break;
                case "repeat": action = PlayerService.ACTION_REPEAT; break;
                case "seek": action = PlayerService.ACTION_SEEK; extras.putExtra("ms", value); break;
                case "playNext": action = PlayerService.ACTION_PLAY_NEXT; extras.putExtra("id", value); break;
                case "addQueue": action = PlayerService.ACTION_ADD_QUEUE; extras.putExtra("id", value); break;
                case "jump": action = PlayerService.ACTION_JUMP; extras.putExtra("index", value); break;
                case "pause": action = PlayerService.ACTION_PAUSE; break;
                case "clear": action = PlayerService.ACTION_CLEAR; break;
                case "sleep": action = PlayerService.ACTION_SLEEP; extras.putExtra("minutes", value); break;
                default: return;
            }
            MainActivity.this.command(action, extras);
        }

        @JavascriptInterface
        public void sync() {
            new Thread(() -> {
                try {
                    SyncManager.sync(MainActivity.this, (message, done, total) -> {
                        try {
                            JSONObject p = new JSONObject().put("message", message).put("done", done).put("total", total);
                            emit("sync_progress", p.toString());
                        } catch (Exception ignored) {
                        }
                    });
                    emit("sync_done", new JSONObject().put("ok", true).toString());
                } catch (Exception e) {
                    try {
                        emit("sync_done", new JSONObject().put("ok", false).put("message", e.getMessage()).toString());
                    } catch (Exception ignored) {
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public void discover() {
            new Thread(() -> {
                List<JSONObject> found = SyncManager.discover(3000);
                emit("discovered", new JSONArray(found).toString());
            }).start();
        }

        @JavascriptInterface
        public void pair(String host, int port, String code) {
            new Thread(() -> {
                try {
                    JSONObject pc = SyncManager.pair(MainActivity.this, host, port > 0 ? port : SyncManager.DEFAULT_PORT, code);
                    emit("paired", new JSONObject().put("ok", true).put("name", pc.optString("name")).toString());
                } catch (Exception e) {
                    try {
                        emit("paired", new JSONObject().put("ok", false).put("message", e.getMessage()).toString());
                    } catch (Exception ignored) {
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public void unpair() {
            Library.get(MainActivity.this).setPc(null);
        }

        @JavascriptInterface
        public void removeTrack(int id) {
            Library.get(MainActivity.this).removeTrack(id);
        }

        /** Requete vers le PC (recherche, apercu, telechargement) ; reponse via l'evenement "pc". */
        @JavascriptInterface
        public void pc(String requestId, String method, String path, String body) {
            new Thread(() -> {
                JSONObject response = new JSONObject();
                try {
                    response.put("id", requestId);
                    JSONObject json = body == null || body.isEmpty() ? null : new JSONObject(body);
                    response.put("data", SyncManager.pcRequest(MainActivity.this, method, path, json));
                    response.put("ok", true);
                } catch (Exception e) {
                    try {
                        response.put("ok", false).put("message", e.getMessage());
                    } catch (Exception ignored) {
                    }
                }
                emit("pc", response.toString());
            }).start();
        }

        @JavascriptInterface
        public String storageInfo() {
            return Library.get(MainActivity.this).storageInfo().toString();
        }

        /** Paroles enregistrees d'un titre ("" s'il n'y en a pas). */
        @JavascriptInterface
        public String lyrics(int id) {
            File file = Library.get(MainActivity.this).lyricsFile(id);
            if (!file.exists()) return "";
            try (java.io.FileInputStream in = new java.io.FileInputStream(file)) {
                byte[] data = new byte[(int) file.length()];
                int read = 0;
                while (read < data.length) {
                    int n = in.read(data, read, data.length - read);
                    if (n < 0) break;
                    read += n;
                }
                return new String(data, 0, read, java.nio.charset.StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        /** Meme chose sans bloquer l'interface : le resultat arrive dans l'evenement "storage". */
        @JavascriptInterface
        public void requestStorageInfo() {
            new Thread(() -> emit("storage", Library.get(MainActivity.this).storageInfo().toString())).start();
        }

        @JavascriptInterface
        public void moveStorage(int target) {
            MainActivity.this.command(PlayerService.ACTION_PAUSE, null);
            new Thread(() -> {
                try {
                    Library.get(MainActivity.this).moveStorage(target, (done, total) -> {
                        try {
                            emit("storage_progress", new JSONObject().put("done", done).put("total", total).toString());
                        } catch (Exception ignored) {
                        }
                    });
                    emit("storage_done", new JSONObject().put("ok", true).toString());
                } catch (Exception e) {
                    try {
                        emit("storage_done", new JSONObject().put("ok", false).put("message", e.getMessage()).toString());
                    } catch (Exception ignored) {
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public void removeAll() {
            MainActivity.this.command(PlayerService.ACTION_CLEAR, null);
            Library.get(MainActivity.this).removeAll();
        }

        /** Reglages simples enregistres dans la bibliotheque : theme du telephone, synchro a l'ouverture. */
        @JavascriptInterface
        public void setSetting(String key, String value) {
            Library lib = Library.get(MainActivity.this);
            if ("theme_override".equals(key)) lib.put(key, value);
            else if ("auto_sync".equals(key)) lib.put(key, "true".equals(value));
            else if ("crossfade".equals(key)) lib.put(key, Integer.parseInt(value));
            else if ("normalize".equals(key) || "spatial".equals(key)) {
                lib.put(key, "true".equals(value));
                lib.save();
                if (PlayerService.instance != null) PlayerService.instance.refreshGain();
                return;
            }
            else if ("background_sync".equals(key)) {
                lib.put(key, "true".equals(value));
                SyncJobService.schedule(MainActivity.this, "true".equals(value));
            }
            else return;
            lib.save();
        }

        @JavascriptInterface
        public long versionCode() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
            } catch (Exception e) {
                return 0;
            }
        }

        /** Ouvre une adresse dans le navigateur (ex. telecharger la nouvelle version de l'appli). */
        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        }

        /** Vrai si Android peut couper l'appli pour economiser la batterie. */
        @JavascriptInterface
        public boolean batteryRestricted() {
            PowerManager pm = getSystemService(PowerManager.class);
            return pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName());
        }

        @JavascriptInterface
        public void requestBatteryExemption() {
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            }
        }

        /** PC injoignable : le telechargement sera transmis a la prochaine synchro. */
        @JavascriptInterface
        public void queueDownload(String videoId, String title, String thumb) {
            Library.get(MainActivity.this).addPendingDownload(videoId, title, thumb);
        }

        @JavascriptInterface
        public int createPlaylist(String name, String idsJson) {
            try {
                return Library.get(MainActivity.this).createPlaylist(name, new JSONArray(idsJson));
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void updatePlaylist(int id, String name, String idsJson) {
            try {
                Library.get(MainActivity.this).updatePlaylist(id, name == null || name.isEmpty() ? null : name,
                        idsJson == null || idsJson.isEmpty() ? null : new JSONArray(idsJson));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void removePlaylist(int id) {
            Library.get(MainActivity.this).removePlaylist(id);
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String deviceName() {
            return SyncManager.deviceName();
        }
    }
}

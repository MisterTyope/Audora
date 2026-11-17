package com.audora.player;

import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Echanges avec Audora sur le PC : decouverte sur le Wi-Fi, association, synchronisation. */
public class SyncManager {
    static final int DISCOVERY_PORT = 47937;
    static final int DEFAULT_PORT = 47936;

    public interface Listener {
        void onProgress(String message, int done, int total);
    }

    public static String deviceName() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "Téléphone" : Build.MODEL;
        if (model.toLowerCase().startsWith(maker.toLowerCase())) return model;
        return (maker.isEmpty() ? "" : Character.toUpperCase(maker.charAt(0)) + maker.substring(1) + " ") + model;
    }

    // --- Decouverte ---

    /** Cherche les PC Audora sur le Wi-Fi (message UDP en diffusion). */
    public static List<JSONObject> discover(int timeoutMs) {
        List<JSONObject> found = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setBroadcast(true);
            socket.setSoTimeout(400);
            byte[] message = "AUDORA_DISCOVER".getBytes(StandardCharsets.UTF_8);
            long end = System.currentTimeMillis() + timeoutMs;
            long nextSend = 0;
            byte[] buffer = new byte[1024];
            while (System.currentTimeMillis() < end) {
                if (System.currentTimeMillis() >= nextSend) {
                    socket.send(new DatagramPacket(message, message.length,
                            InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT));
                    nextSend = System.currentTimeMillis() + 800;
                }
                try {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    socket.receive(packet);
                    JSONObject reply = new JSONObject(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
                    if (!"audora".equals(reply.optString("app"))) continue;
                    String host = packet.getAddress().getHostAddress();
                    if (seen.add(reply.optString("pc_id") + host)) {
                        reply.put("host", host);
                        found.add(reply);
                    }
                } catch (SocketTimeoutException ignored) {
                }
            }
        } catch (Exception ignored) {
        }
        return found;
    }

    // --- HTTP ---

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    // --- Chiffrement (TLS) ---
    //
    // Le PC a un certificat a lui (auto-signe). A la premiere connexion chiffree, on retient son
    // empreinte SHA-256 ("pin") ; ensuite tout autre certificat est refuse. Un PC deja epingle
    // n'est plus jamais contacte en clair.

    private static final int MODE_PLAIN = 0, MODE_FIRST_CONTACT = 1, MODE_PINNED = 2;
    private static volatile int mode = MODE_PLAIN;
    private static volatile String pin = null;
    private static volatile String lastSeenPin = null;
    private static volatile SSLSocketFactory pinnedFactory = null;
    private static volatile String pinnedFactoryFor = null;

    private static String sha256(byte[] data) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(data)) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    private static final class PinTrust implements X509TrustManager {
        private final String expected;

        PinTrust(String expected) {
            this.expected = expected;
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            if (chain == null || chain.length == 0) throw new CertificateException("Pas de certificat");
            String seen;
            try {
                seen = sha256(chain[0].getEncoded());
            } catch (Exception e) {
                throw new CertificateException(e);
            }
            if (expected != null && !expected.equalsIgnoreCase(seen)) {
                throw new CertificateException("Ce n'est pas ton PC (certificat différent)");
            }
            lastSeenPin = seen;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("Non utilise");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    private static SSLSocketFactory factory(String expected) throws IOException {
        try {
            if (expected != null && expected.equals(pinnedFactoryFor) && pinnedFactory != null) return pinnedFactory;
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, new TrustManager[]{new PinTrust(expected)}, null);
            SSLSocketFactory f = context.getSocketFactory();
            if (expected != null) {
                pinnedFactory = f;
                pinnedFactoryFor = expected;
            }
            return f;
        } catch (Exception e) {
            throw new IOException(e);
        }
    }

    /** Mode de connexion pour ce PC : chiffre et epingle s'il l'a deja ete, en clair sinon (pour l'instant). */
    private static void prepare(JSONObject pc) {
        String saved = pc == null ? "" : pc.optString("tls_sha256", "");
        if (!saved.isEmpty()) {
            pin = saved;
            mode = MODE_PINNED;
        } else {
            pin = null;
            mode = MODE_PLAIN;
        }
    }

    /** PC deja associe mais pas encore chiffre (appli mise a jour) : on passe au chiffrement une fois pour toutes. */
    private static void upgrade(Context context, JSONObject pc, String host, int port) {
        if (mode == MODE_PINNED) return;
        try {
            JSONObject hello = request(host, port, "GET", "/sync/hello", null, null);
            if (!hello.optBoolean("tls")) return;  // Audora du PC trop ancien : on reste en clair
            String seen = firstContact(host, port);
            if (seen == null) return;
            pc.put("tls_sha256", seen);
            Library.get(context).setPc(pc);
            pin = seen;
            mode = MODE_PINNED;
        } catch (Exception ignored) {
            // on reessaiera a la prochaine connexion
        }
    }

    /** Premiere connexion chiffree : retourne l'empreinte du certificat du PC. */
    private static String firstContact(String host, int port) throws Exception {
        int previous = mode;
        mode = MODE_FIRST_CONTACT;
        lastSeenPin = null;
        try {
            request(host, port, "GET", "/sync/hello", null, null);
            return lastSeenPin;
        } finally {
            mode = previous;
        }
    }

    private static HttpURLConnection open(String host, int port, String path, String token, int readTimeout) throws IOException {
        boolean secure = mode != MODE_PLAIN;
        HttpURLConnection c = (HttpURLConnection) new URL((secure ? "https://" : "http://") + host + ":" + port + path).openConnection();
        if (secure) {
            HttpsURLConnection https = (HttpsURLConnection) c;
            https.setSSLSocketFactory(factory(mode == MODE_PINNED ? pin : null));
            https.setHostnameVerifier((name, session) -> true);  // l'empreinte suffit : l'adresse IP du PC peut changer
        }
        c.setConnectTimeout(4000);
        c.setReadTimeout(readTimeout);
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        return c;
    }

    private static JSONObject request(String host, int port, String method, String path, String token, JSONObject body) throws Exception {
        HttpURLConnection c = open(host, port, path, token, 15000);
        try {
            c.setRequestMethod(method);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            String text = in == null ? "{}" : readAll(in);
            JSONObject json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            if (code == 401) throw new Exception("Ce téléphone n'est plus associé. Associe-le à nouveau depuis Audora sur le PC.");
            if (code >= 400) throw new Exception(json.optString("error", "Erreur " + code));
            return json;
        } finally {
            c.disconnect();
        }
    }

    // --- Association ---

    public static JSONObject pair(Context context, String host, int port, String code) throws Exception {
        JSONObject body = new JSONObject();
        body.put("code", code.replaceAll("\\s", ""));
        body.put("name", deviceName());
        JSONObject result;
        String seen = null;
        try {
            prepare(null);
            JSONObject hello = request(host, port, "GET", "/sync/hello", null, null);
            if (hello.optBoolean("tls")) {
                try {
                    seen = firstContact(host, port);
                } catch (Exception e) {
                    seen = null;  // chiffrement impossible pour l'instant : association en clair, chiffree plus tard
                }
                if (seen != null) {
                    pin = seen;
                    mode = MODE_PINNED;  // le code part chiffre, vers ce certificat-la uniquement
                }
            }
            result = request(host, port, "POST", "/sync/pair", null, body);
        } catch (IOException e) {
            prepare(null);
            throw new Exception("Impossible de joindre le PC. Vérifie qu'Audora est ouvert, que la synchronisation est activée et que le téléphone est sur le même Wi-Fi.");
        }
        JSONObject pc = new JSONObject();
        if (seen != null) pc.put("tls_sha256", seen);
        pc.put("host", host);
        pc.put("port", port);
        pc.put("token", result.getString("token"));
        pc.put("pc_id", result.optString("pc_id"));
        pc.put("name", result.optString("pc_name", "PC"));
        Library.get(context).setPc(pc);
        return pc;
    }

    // --- Synchronisation ---

    /** Retrouve le PC : derniere adresse connue, sinon nouvelle recherche sur le Wi-Fi (l'adresse peut changer). */
    private static String locatePc(JSONObject pc) {
        String host = pc.optString("host");
        int port = pc.optInt("port", DEFAULT_PORT);
        try {
            JSONObject hello = request(host, port, "GET", "/sync/hello", null, null);
            if (pc.optString("pc_id").equals(hello.optString("pc_id"))) return host;
        } catch (Exception ignored) {
        }
        for (JSONObject reply : discover(3000)) {
            if (pc.optString("pc_id").equals(reply.optString("pc_id"))) return reply.optString("host");
        }
        return null;
    }

    private static volatile String reachableHost = null;

    /**
     * Requete vers Audora sur le PC pour l'interface (recherche YouTube, apercu, telechargement).
     * Seules les adresses /sync/... sont autorisees.
     */
    public static JSONObject pcRequest(Context context, String method, String path, JSONObject body) throws Exception {
        if (!path.startsWith("/sync/") || path.contains("..")) throw new Exception("Requête refusée");
        JSONObject pc = Library.get(context).pc();
        if (pc == null) throw new Exception("Associe d'abord ton PC dans les réglages.");
        int port = pc.optInt("port", DEFAULT_PORT);
        String token = pc.getString("token");
        String host = reachableHost != null ? reachableHost : pc.optString("host");
        prepare(pc);
        upgrade(context, pc, host, port);
        try {
            JSONObject result = request(host, port, method, path, token, body);
            reachableHost = host;
            return result;
        } catch (IOException first) {
            String found = locatePc(pc);
            if (found == null) {
                throw new Exception("PC injoignable. La recherche YouTube passe par Audora sur ton PC : il doit être allumé, sur le même Wi-Fi.");
            }
            reachableHost = found;
            if (!found.equals(pc.optString("host"))) {
                pc.put("host", found);
                Library.get(context).setPc(pc);
            }
            return request(found, port, method, path, token, body);
        }
    }

    /** Passage d'une musique decoupe par le PC (ffmpeg, avec fondus), pour une sonnerie. */
    public static void downloadRingtone(Context context, int trackId, long startMs, long endMs, File dest) throws Exception {
        JSONObject pc = Library.get(context).pc();
        if (pc == null) throw new Exception("Pas de PC associé");
        int port = pc.optInt("port", DEFAULT_PORT);
        String host = reachableHost != null ? reachableHost : pc.optString("host");
        prepare(pc);
        download(host, port, "/sync/ringtone/" + trackId + "?start=" + startMs + "&end=" + endMs, pc.getString("token"), dest);
    }

    private static final ReentrantLock SYNC_LOCK = new ReentrantLock();

    public static void sync(Context context, Listener listener) throws Exception {
        // La synchro peut venir de l'appli et de l'arriere-plan en meme temps : une seule a la fois.
        if (!SYNC_LOCK.tryLock()) throw new Exception("Une synchronisation est déjà en cours.");
        try {
            syncLocked(context, listener);
        } finally {
            SYNC_LOCK.unlock();
        }
    }

    /** Le fichier du telephone a-t-il deja le bon son ? (les tags seuls ne comptent pas) */
    private static boolean sameAudio(JSONObject have, JSONObject wanted, File file) {
        if (have == null || !file.exists()) return false;
        String key = wanted.optString("audio_key", "");
        String haveKey = have.optString("audio_key", "");
        if (!key.isEmpty() && !haveKey.isEmpty()) return key.equals(haveKey);
        if (file.length() == wanted.optLong("size") && have.optLong("mtime") == wanted.optLong("mtime")) return true;
        // Ancienne version de l'appli (sans empreinte) : meme duree et taille presque identique
        // = seuls les tags ont change, inutile de retelecharger.
        return Math.abs(file.length() - wanted.optLong("size")) < 256 * 1024
                && Math.abs(have.optDouble("duration", 0) - wanted.optDouble("duration", 0)) < 1.5;
    }

    private static void syncLocked(Context context, Listener listener) throws Exception {
        Library lib = Library.get(context);
        JSONObject pc = lib.pc();
        if (pc == null) throw new Exception("Associe d'abord ton PC.");
        listener.onProgress("Recherche du PC…", 0, 0);
        prepare(pc);
        String host = locatePc(pc);
        if (host == null) {
            throw new Exception("PC introuvable. Vérifie qu'Audora est ouvert sur le PC, avec la synchronisation activée, et que tu es sur le même Wi-Fi.");
        }
        if (!host.equals(pc.optString("host"))) {
            pc.put("host", host);
            lib.setPc(pc);
        }
        int port = pc.optInt("port", DEFAULT_PORT);
        String token = pc.getString("token");
        reachableHost = host;
        upgrade(context, pc, host, port);

        // 1) Telechargements demandes quand le PC etait eteint : on les transmet maintenant.
        JSONArray pending = lib.pendingDownloads();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject item = pending.optJSONObject(i);
            if (item == null) continue;
            try {
                request(host, port, "POST", "/sync/download", token, item);
                lib.removePendingDownload(item.optString("id"));
            } catch (Exception ignored) {
                // on reessaiera a la prochaine synchro
            }
        }

        // 2) Ecoutes, titres retires et playlists modifiees depuis le telephone.
        request(host, port, "POST", "/sync/report", token, lib.pendingReport());
        lib.clearPendingReport();

        // 3) Ce que le telephone doit avoir.
        listener.onProgress("Préparation…", 0, 0);
        JSONObject manifest = request(host, port, "GET", "/sync/manifest", token, null);
        JSONArray wanted = manifest.getJSONArray("tracks");

        Map<Integer, JSONObject> local = new HashMap<>();
        JSONArray current = lib.tracks();
        for (int i = 0; i < current.length(); i++) {
            JSONObject t = current.optJSONObject(i);
            if (t != null) local.put(t.optInt("id"), t);
        }

        List<JSONObject> toDownload = new ArrayList<>();
        List<JSONObject> coversToRefresh = new ArrayList<>();
        for (int i = 0; i < wanted.length(); i++) {
            JSONObject t = wanted.getJSONObject(i);
            JSONObject have = local.get(t.getInt("id"));
            if (!sameAudio(have, t, lib.audioFile(t))) {
                toDownload.add(t);
            } else if (t.optBoolean("cover") && (!lib.coverFile(t.getInt("id")).exists()
                    || have.optLong("cover_mtime") != t.optLong("cover_mtime"))) {
                coversToRefresh.add(t);  // seule la pochette a change
            }
        }

        // 4) Telechargement de ce qui manque.
        int done = 0;
        for (JSONObject t : toDownload) {
            listener.onProgress(t.optString("title"), done, toDownload.size());
            download(host, port, "/sync/file/" + t.getInt("id"), token, lib.audioFile(t));
            coversToRefresh.add(t);
            done++;
        }
        // Paroles : telechargees quand le PC en a trouve (ou de nouvelles).
        for (int i = 0; i < wanted.length(); i++) {
            JSONObject t = wanted.getJSONObject(i);
            JSONObject have = local.get(t.getInt("id"));
            File lyricsFile = lib.lyricsFile(t.getInt("id"));
            long version = t.optLong("lyrics", 0);
            if (version == 0) {
                if (lyricsFile.exists()) lyricsFile.delete();
            } else if (!lyricsFile.exists() || have == null || have.optLong("lyrics", 0) != version) {
                try {
                    download(host, port, "/sync/lyrics/" + t.getInt("id"), token, lyricsFile);
                } catch (Exception ignored) {
                    // pas de paroles : la musique s'ecoute quand meme
                }
            }
        }
        for (JSONObject t : coversToRefresh) {
            if (!t.optBoolean("cover")) continue;
            try {
                download(host, port, "/sync/cover/" + t.getInt("id"), token, lib.coverFile(t.getInt("id")));
            } catch (Exception ignored) {
                // une pochette manquante n'empeche pas d'ecouter
            }
        }

        // 5) On retire ce qui n'est plus dans la liste, et on enregistre la nouvelle bibliotheque.
        Set<Integer> keep = new HashSet<>();
        JSONArray merged = new JSONArray();
        for (int i = 0; i < wanted.length(); i++) {
            JSONObject t = wanted.getJSONObject(i);
            keep.add(t.getInt("id"));
            JSONObject have = local.get(t.getInt("id"));
            if (have != null) {
                t.put("play_count", have.optInt("play_count"));
                t.put("last_played", have.optDouble("last_played", 0));
            }
            if (!lib.coverFile(t.getInt("id")).exists()) t.put("cover", false);
            merged.put(t);
        }
        for (JSONObject t : local.values()) {
            if (!keep.contains(t.optInt("id"))) {
                lib.audioFile(t).delete();
                lib.coverFile(t.optInt("id")).delete();
                lib.lyricsFile(t.optInt("id")).delete();
            }
        }
        lib.put("tracks", merged);
        lib.put("playlists", manifest.optJSONArray("playlists") == null ? new JSONArray() : manifest.getJSONArray("playlists"));
        lib.put("theme", manifest.optString("theme", "prune"));
        lib.put("apk", manifest.optJSONObject("apk") == null ? JSONObject.NULL : manifest.getJSONObject("apk"));
        lib.put("last_sync", System.currentTimeMillis() / 1000.0);
        lib.save();
        listener.onProgress(done == 0 ? "Déjà à jour" : done + (done > 1 ? " titres reçus" : " titre reçu"), done, toDownload.size());
    }

    private static void download(String host, int port, String path, String token, File dest) throws Exception {
        File tmp = new File(dest.getPath() + ".part");
        HttpURLConnection c = open(host, port, path, token, 60000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("Téléchargement impossible (" + c.getResponseCode() + ")");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        } finally {
            c.disconnect();
        }
        if (dest.exists()) dest.delete();
        if (!tmp.renameTo(dest)) throw new IOException("Écriture impossible : " + dest);
    }
}

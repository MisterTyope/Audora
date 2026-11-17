package com.audora.player;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Environment;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;

/**
 * Bibliotheque du telephone : un fichier library.json (titres, playlists, PC associe,
 * ecoutes a renvoyer) et les fichiers audio/pochettes dans le stockage de l'appli.
 */
public class Library {
    private static Library instance;

    public interface Progress {
        void onProgress(int done, int total);
    }

    private final Context context;
    private final File file;
    File musicDir, lyricsDir;
    File coverDir;
    private JSONObject data;

    public static synchronized Library get(Context context) {
        if (instance == null) instance = new Library(context.getApplicationContext());
        return instance;
    }

    private Library(Context context) {
        this.context = context;
        file = new File(context.getFilesDir(), "library.json");
        applyStorage();
        load();
    }

    // --- Emplacement des musiques : memoire du telephone ou carte SD ---

    private SharedPreferences prefs() {
        return context.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    /** Espaces de stockage prives de l'appli : [0] = memoire du telephone, [1..] = cartes SD. */
    private List<File> storageRoots() {
        List<File> roots = new ArrayList<>();
        for (File dir : context.getExternalFilesDirs(null)) {
            if (dir != null && Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState(dir))) roots.add(dir);
        }
        if (roots.isEmpty()) roots.add(context.getFilesDir());
        return roots;
    }

    private synchronized void applyStorage() {
        List<File> roots = storageRoots();
        int index = prefs().getInt("storage", 0);
        File root = index < roots.size() ? roots.get(index) : roots.get(0);
        musicDir = new File(root, "music");
        coverDir = new File(root, "covers");
        lyricsDir = new File(root, "lyrics");
        musicDir.mkdirs();
        coverDir.mkdirs();
        lyricsDir.mkdirs();
    }

    private static long dirSize(File dir) {
        long size = 0;
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) size += f.isFile() ? f.length() : 0;
        return size;
    }

    public synchronized JSONObject storageInfo() {
        JSONObject info = new JSONObject();
        try {
            List<File> roots = storageRoots();
            int current = Math.min(prefs().getInt("storage", 0), roots.size() - 1);
            JSONArray options = new JSONArray();
            for (int i = 0; i < roots.size(); i++) {
                File root = roots.get(i);
                boolean removable = i > 0 && Environment.isExternalStorageRemovable(root);
                options.put(new JSONObject()
                        .put("index", i)
                        .put("label", i == 0 ? "Mémoire du téléphone" : removable ? "Carte SD" : "Stockage externe")
                        .put("free", root.getUsableSpace())
                        .put("total", root.getTotalSpace()));
            }
            info.put("options", options);
            info.put("current", current);
            info.put("used", dirSize(musicDir) + dirSize(coverDir));
            info.put("count", tracks().length());
        } catch (JSONException ignored) {
        }
        return info;
    }

    /** Deplace toutes les musiques vers un autre stockage (memoire <-> carte SD). */
    public synchronized void moveStorage(int target, Progress progress) throws Exception {
        List<File> roots = storageRoots();
        if (target < 0 || target >= roots.size()) throw new Exception("Cet emplacement n'est plus disponible.");
        File newMusic = new File(roots.get(target), "music");
        File newCovers = new File(roots.get(target), "covers");
        if (newMusic.equals(musicDir)) return;
        newMusic.mkdirs();
        newCovers.mkdirs();
        File[] music = musicDir.listFiles();
        File[] covers = coverDir.listFiles();
        int total = (music == null ? 0 : music.length) + (covers == null ? 0 : covers.length);
        long needed = dirSize(musicDir) + dirSize(coverDir);
        if (roots.get(target).getUsableSpace() < needed + 50L * 1024 * 1024) {
            throw new Exception("Pas assez de place à cet endroit.");
        }
        int done = 0;
        for (File[] group : new File[][]{music, covers}) {
            if (group == null) continue;
            File dest = group == music ? newMusic : newCovers;
            for (File f : group) {
                // Files.move copie puis supprime quand on change de stockage
                Files.move(f.toPath(), new File(dest, f.getName()).toPath(), StandardCopyOption.REPLACE_EXISTING);
                progress.onProgress(++done, total);
            }
        }
        prefs().edit().putInt("storage", target).apply();
        applyStorage();
    }

    private void load() {
        try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()];
            int read = 0;
            while (read < bytes.length) {
                int n = in.read(bytes, read, bytes.length - read);
                if (n < 0) break;
                read += n;
            }
            data = new JSONObject(new String(bytes, 0, read, StandardCharsets.UTF_8));
        } catch (Exception e) {
            data = new JSONObject();
        }
        try {
            if (!data.has("tracks")) data.put("tracks", new JSONArray());
            if (!data.has("playlists")) data.put("playlists", new JSONArray());
            if (!data.has("plays")) data.put("plays", new JSONObject());
            if (!data.has("removed")) data.put("removed", new JSONArray());
            if (!data.has("auto_sync")) data.put("auto_sync", true);
            if (!data.has("background_sync")) data.put("background_sync", true);
            if (!data.has("pending_downloads")) data.put("pending_downloads", new JSONArray());
            if (!data.has("playlist_ops")) data.put("playlist_ops", new JSONArray());
        } catch (JSONException ignored) {
        }
    }

    public synchronized void save() {
        File tmp = new File(file.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(data.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return;
        }
        if (!tmp.renameTo(file)) {
            file.delete();
            tmp.renameTo(file);
        }
    }

    public synchronized String json() {
        return data.toString();
    }

    public synchronized JSONArray tracks() {
        return data.optJSONArray("tracks");
    }

    public synchronized JSONObject track(int id) {
        JSONArray tracks = tracks();
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t != null && t.optInt("id") == id) return t;
        }
        return null;
    }

    public File audioFile(JSONObject track) {
        return new File(musicDir, track.optInt("id") + track.optString("ext", ".mp3"));
    }

    public File coverFile(int id) {
        return new File(coverDir, id + ".jpg");
    }

    /** Paroles d'un titre (JSON {"synced", "plain"} recu du PC), pour les avoir hors ligne. */
    public File lyricsFile(int id) {
        return new File(lyricsDir, id + ".json");
    }

    public synchronized JSONObject pc() {
        return data.optJSONObject("pc");
    }

    public synchronized void setPc(JSONObject pc) {
        try {
            if (pc == null) data.remove("pc");
            else data.put("pc", pc);
        } catch (JSONException ignored) {
        }
        save();
    }

    public synchronized void put(String key, Object value) {
        try {
            data.put(key, value);
        } catch (JSONException ignored) {
        }
    }

    /** Duree du fondu enchaine en secondes (0 = desactive, reglage "crossfade"). */
    public synchronized int crossfadeSeconds() {
        return Math.max(0, Math.min(12, data.optInt("crossfade", 0)));
    }

    public synchronized void recordPlay(int id) {
        JSONObject plays = data.optJSONObject("plays");
        try {
            plays.put(String.valueOf(id), plays.optInt(String.valueOf(id)) + 1);
            JSONObject t = track(id);
            if (t != null) {
                t.put("play_count", t.optInt("play_count") + 1);
                t.put("last_played", System.currentTimeMillis() / 1000.0);
            }
        } catch (JSONException ignored) {
        }
        save();
    }

    /** Ecoutes et suppressions en attente, a renvoyer au PC. */
    public synchronized JSONObject pendingReport() {
        JSONObject report = new JSONObject();
        try {
            report.put("plays", data.optJSONObject("plays"));
            report.put("removed", data.optJSONArray("removed"));
            report.put("remove_all", data.optBoolean("remove_all"));
            report.put("playlist_ops", data.optJSONArray("playlist_ops"));
        } catch (JSONException ignored) {
        }
        return report;
    }

    public synchronized void clearPendingReport() {
        try {
            data.put("plays", new JSONObject());
            data.put("removed", new JSONArray());
            data.remove("remove_all");
            data.put("playlist_ops", new JSONArray());
        } catch (JSONException ignored) {
        }
        save();
    }

    public synchronized boolean getBool(String key, boolean fallback) {
        return data.optBoolean(key, fallback);
    }

    // --- Telechargements demandes quand le PC etait injoignable ---

    public synchronized JSONArray pendingDownloads() {
        return data.optJSONArray("pending_downloads");
    }

    public synchronized void addPendingDownload(String videoId, String title, String thumb) {
        JSONArray list = pendingDownloads();
        for (int i = 0; i < list.length(); i++) {
            if (videoId.equals(list.optJSONObject(i).optString("id"))) return;
        }
        try {
            list.put(new JSONObject().put("id", videoId).put("title", title).put("thumb", thumb));
        } catch (JSONException ignored) {
        }
        save();
    }

    public synchronized void removePendingDownload(String videoId) {
        JSONArray list = pendingDownloads();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject item = list.optJSONObject(i);
            if (item != null && !videoId.equals(item.optString("id"))) kept.put(item);
        }
        put("pending_downloads", kept);
        save();
    }

    // --- Playlists modifiees sur le telephone (renvoyees au PC a la synchro) ---

    private JSONObject playlist(int id) {
        JSONArray list = data.optJSONArray("playlists");
        for (int i = 0; i < list.length(); i++) {
            JSONObject p = list.optJSONObject(i);
            if (p != null && p.optInt("id") == id) return p;
        }
        return null;
    }

    private void addOp(JSONObject op) {
        data.optJSONArray("playlist_ops").put(op);
    }

    /** Nouvelle playlist : identifiant provisoire negatif jusqu'a la prochaine synchro. */
    public synchronized int createPlaylist(String name, JSONArray trackIds) {
        int tempId = -(int) (System.currentTimeMillis() % 1_000_000_000L);
        try {
            data.optJSONArray("playlists").put(new JSONObject().put("id", tempId).put("name", name).put("track_ids", trackIds).put("local", true));
            addOp(new JSONObject().put("op", "create").put("temp_id", tempId).put("name", name).put("track_ids", trackIds));
        } catch (JSONException ignored) {
        }
        save();
        return tempId;
    }

    public synchronized void updatePlaylist(int id, String name, JSONArray trackIds) {
        JSONObject p = playlist(id);
        if (p == null) return;
        try {
            if (name != null) p.put("name", name);
            if (trackIds != null) p.put("track_ids", trackIds);
            JSONObject op = new JSONObject().put("op", "update").put("id", id);
            if (name != null) op.put("name", name);
            op.put("track_ids", p.optJSONArray("track_ids"));
            addOp(op);
        } catch (JSONException ignored) {
        }
        save();
    }

    /** Retire la playlist du telephone (elle reste sur le PC). */
    public synchronized void removePlaylist(int id) {
        JSONArray list = data.optJSONArray("playlists");
        JSONArray kept = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject p = list.optJSONObject(i);
            if (p != null && p.optInt("id") != id) kept.put(p);
        }
        put("playlists", kept);
        if (id < 0) {
            // Creee ici et jamais synchronisee : on oublie simplement sa creation.
            JSONArray ops = data.optJSONArray("playlist_ops");
            JSONArray keptOps = new JSONArray();
            for (int i = 0; i < ops.length(); i++) {
                JSONObject op = ops.optJSONObject(i);
                if (op != null && op.optInt("temp_id") != id && op.optInt("id") != id) keptOps.put(op);
            }
            put("playlist_ops", keptOps);
        } else {
            try {
                addOp(new JSONObject().put("op", "remove").put("id", id));
            } catch (JSONException ignored) {
            }
        }
        save();
    }

    /** "Supprimer toutes les musiques" : vide le telephone et previent le PC a la prochaine synchro. */
    public synchronized void removeAll() {
        for (File dir : new File[]{musicDir, coverDir}) {
            File[] files = dir.listFiles();
            if (files != null) for (File f : files) f.delete();
        }
        try {
            data.put("tracks", new JSONArray());
            data.put("playlists", new JSONArray());
            data.put("removed", new JSONArray());
            data.put("remove_all", true);
        } catch (JSONException ignored) {
        }
        save();
    }

    /** "Retirer du telephone" depuis l'appli : supprime le fichier et previent le PC a la prochaine synchro. */
    public synchronized void removeTrack(int id) {
        JSONArray tracks = tracks();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t == null) continue;
            if (t.optInt("id") == id) {
                audioFile(t).delete();
                coverFile(id).delete();
            } else {
                kept.put(t);
            }
        }
        try {
            data.put("tracks", kept);
            data.optJSONArray("removed").put(id);
        } catch (JSONException ignored) {
        }
        save();
    }
}

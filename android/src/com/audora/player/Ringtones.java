package com.audora.player;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/**
 * Sonnerie, son de notification ou d'alarme a partir d'un passage d'une musique.
 *
 * 1) Decoupe : par le PC si on le joint (ffmpeg, avec un leger fondu au debut et a la fin),
 *    sinon sur le telephone, sans reencodage (MP3 : trame par trame ; M4A : MediaMuxer).
 * 2) Enregistrement dans les sons d'Android (dossier Ringtones, Notifications ou Alarms).
 * 3) Reglage par defaut (sonnerie, notification) : demande l'autorisation "Modifier les
 *    parametres systeme". Les alarmes, elles, se choisissent dans l'appli Horloge.
 */
final class Ringtones {
    static final long MAX_MS = 40_000;

    private Ringtones() {
    }

    /** Fichier decoupe (dans le cache de l'appli), extension .mp3 ou .m4a. Retourne {fichier, "pc"|"local"}. */
    static Object[] cut(Context context, JSONObject track, long startMs, long endMs) throws Exception {
        Library lib = Library.get(context);
        File src = lib.audioFile(track);
        if (!src.exists()) throw new Exception("Ce titre n'est plus sur le téléphone.");
        File dir = new File(context.getCacheDir(), "sonneries");
        dir.mkdirs();
        // 1) Par le PC : decoupe propre avec fondus.
        File viaPc = new File(dir, "pc.mp3");
        try {
            SyncManager.downloadRingtone(context, track.getInt("id"), startMs, endMs, viaPc);
            if (viaPc.length() > 1000) return new Object[]{viaPc, "pc"};
        } catch (Exception ignored) {
            // PC eteint ou injoignable : decoupe sur le telephone
        }
        // 2) Sur le telephone.
        if (src.getName().toLowerCase().endsWith(".mp3")) {
            File out = new File(dir, "local.mp3");
            cutMp3(src, out, startMs, endMs);
            return new Object[]{out, "local"};
        }
        File out = new File(dir, "local.m4a");
        cutWithMuxer(src, out, startMs, endMs);
        return new Object[]{out, "local"};
    }

    // --- Decoupe MP3, trame par trame (pas de reencodage) ---

    private static final int[] BITRATE_V1 = {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320};
    private static final int[] BITRATE_V2 = {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160};
    private static final int[] SAMPLE_RATE = {44100, 48000, 32000};

    static void cutMp3(File src, File dest, long startMs, long endMs) throws IOException {
        byte[] data = readAll(src);
        int pos = 0;
        if (data.length > 10 && data[0] == 'I' && data[1] == 'D' && data[2] == '3') {  // tag ID3v2 a sauter
            int size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F);
            pos = 10 + size + ((data[5] & 0x10) != 0 ? 10 : 0);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        double timeMs = 0;
        boolean first = true;
        while (pos + 4 <= data.length && timeMs < endMs) {
            int h = ((data[pos] & 0xFF) << 24) | ((data[pos + 1] & 0xFF) << 16) | ((data[pos + 2] & 0xFF) << 8) | (data[pos + 3] & 0xFF);
            int version = (h >>> 19) & 3, layer = (h >>> 17) & 3, br = (h >>> 12) & 0xF, sr = (h >>> 10) & 3, pad = (h >>> 9) & 1;
            if ((h & 0xFFE00000) != 0xFFE00000 || version == 1 || layer != 1 || br == 0 || br == 15 || sr == 3) {
                pos++;  // pas une trame MP3 : on se recale
                continue;
            }
            boolean mpeg1 = version == 3;
            int rate = SAMPLE_RATE[sr] / (mpeg1 ? 1 : version == 2 ? 2 : 4);
            int bitrate = (mpeg1 ? BITRATE_V1 : BITRATE_V2)[br] * 1000;
            int length = (mpeg1 ? 144 : 72) * bitrate / rate + pad;
            if (length < 4 || pos + length > data.length) break;
            boolean infoFrame = first && contains(data, pos, length, "Xing") || first && contains(data, pos, length, "Info");
            first = false;
            if (!infoFrame) {  // la trame "Xing/Info" decrit le fichier entier : on ne la garde pas
                if (timeMs >= startMs) out.write(data, pos, length);
                timeMs += (mpeg1 ? 1152 : 576) * 1000.0 / rate;
            }
            pos += length;
        }
        if (out.size() == 0) throw new IOException("Passage introuvable dans le fichier.");
        try (FileOutputStream f = new FileOutputStream(dest)) {
            out.writeTo(f);
        }
    }

    private static boolean contains(byte[] data, int from, int length, String word) {
        byte[] w = word.getBytes(StandardCharsets.US_ASCII);
        int end = Math.min(data.length, from + Math.min(length, 64)) - w.length;
        outer:
        for (int i = from; i <= end; i++) {
            for (int j = 0; j < w.length; j++) if (data[i + j] != w[j]) continue outer;
            return true;
        }
        return false;
    }

    // --- Decoupe M4A (AAC) sans reencodage ---

    static void cutWithMuxer(File src, File dest, long startMs, long endMs) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        try {
            extractor.setDataSource(src.getPath());
            int track = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    track = i;
                    format = f;
                    break;
                }
            }
            if (track < 0 || !"audio/mp4a-latm".equals(format.getString(MediaFormat.KEY_MIME))) {
                throw new Exception("Ce format ne peut pas être découpé sur le téléphone : réessaie avec le PC allumé.");
            }
            extractor.selectTrack(track);
            muxer = new MediaMuxer(dest.getPath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int out = muxer.addTrack(format);
            muxer.start();
            long startUs = startMs * 1000, endUs = endMs * 1000;
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
            ByteBuffer buffer = ByteBuffer.allocate(1 << 20);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            int size;
            while ((size = extractor.readSampleData(buffer, 0)) >= 0) {
                long time = extractor.getSampleTime();
                if (time > endUs) break;
                info.set(0, size, Math.max(0, time - startUs), extractor.getSampleFlags());
                muxer.writeSampleData(out, buffer, info);
                extractor.advance();
            }
            muxer.stop();
        } finally {
            extractor.release();
            if (muxer != null) muxer.release();
        }
    }

    // --- Enregistrement dans les sons d'Android ---

    /** type : "ringtone", "notification" ou "alarm". Retourne l'adresse du son enregistre. */
    static Uri install(Context context, File file, String title, String type) throws Exception {
        String ext = file.getName().endsWith(".m4a") ? ".m4a" : ".mp3";
        String mime = ext.equals(".m4a") ? "audio/mp4" : "audio/mpeg";
        String name = ("Audora - " + title).replaceAll("[\\\\/:*?\"<>|]", " ").trim() + ext;
        String folder = "alarm".equals(type) ? Environment.DIRECTORY_ALARMS
                : "notification".equals(type) ? Environment.DIRECTORY_NOTIFICATIONS : Environment.DIRECTORY_RINGTONES;

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.TITLE, "Audora - " + title);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.Audio.Media.IS_RINGTONE, "ringtone".equals(type));
        values.put(MediaStore.Audio.Media.IS_NOTIFICATION, "notification".equals(type));
        values.put(MediaStore.Audio.Media.IS_ALARM, "alarm".equals(type));
        values.put(MediaStore.Audio.Media.IS_MUSIC, false);
        ContentResolver resolver = context.getContentResolver();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            if (uri == null) throw new Exception("Android a refusé d'enregistrer le son.");
            try (OutputStream out = resolver.openOutputStream(uri); InputStream in = new FileInputStream(file)) {
                copy(in, out);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri;
        }
        // Android 8 et 9 : fichier dans le dossier public (autorisation de stockage requise).
        File dir = Environment.getExternalStoragePublicDirectory(folder);
        dir.mkdirs();
        File dest = new File(dir, name);
        try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(dest)) {
            copy(in, out);
        }
        values.put(MediaStore.MediaColumns.DATA, dest.getAbsolutePath());
        Uri uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("Android a refusé d'enregistrer le son.");
        return uri;
    }

    /** Son par defaut du telephone. False si l'autorisation "Modifier les parametres systeme" manque. */
    static boolean setDefault(Context context, Uri uri, String type) {
        if (!Settings.System.canWrite(context)) return false;
        int kind = "alarm".equals(type) ? RingtoneManager.TYPE_ALARM
                : "notification".equals(type) ? RingtoneManager.TYPE_NOTIFICATION : RingtoneManager.TYPE_RINGTONE;
        RingtoneManager.setActualDefaultRingtoneUri(context, kind, uri);
        return true;
    }

    private static byte[] readAll(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(file.length(), Integer.MAX_VALUE));
            copy(in, out);
            return out.toByteArray();
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }
}

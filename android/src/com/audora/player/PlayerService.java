package com.audora.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.audiofx.AudioEffect;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.Virtualizer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Lecture en arriere-plan : file d'attente, MediaSession (ecran verrouille, Bluetooth,
 * boutons des ecouteurs), notification de lecture, gestion du focus audio.
 */
public class PlayerService extends Service implements AudioManager.OnAudioFocusChangeListener {
    static final String ACTION_PLAY_QUEUE = "com.audora.player.PLAY_QUEUE";
    static final String ACTION_TOGGLE = "com.audora.player.TOGGLE";
    static final String ACTION_PLAY = "com.audora.player.PLAY";
    static final String ACTION_PAUSE = "com.audora.player.PAUSE";
    static final String ACTION_NEXT = "com.audora.player.NEXT";
    static final String ACTION_PREV = "com.audora.player.PREV";
    static final String ACTION_SEEK = "com.audora.player.SEEK";
    static final String ACTION_SHUFFLE = "com.audora.player.SHUFFLE";
    static final String ACTION_REPEAT = "com.audora.player.REPEAT";
    static final String ACTION_PLAY_NEXT = "com.audora.player.PLAY_NEXT";
    static final String ACTION_ADD_QUEUE = "com.audora.player.ADD_QUEUE";
    static final String ACTION_JUMP = "com.audora.player.JUMP";
    static final String ACTION_CLEAR = "com.audora.player.CLEAR";
    static final String ACTION_SLEEP = "com.audora.player.SLEEP";

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 1;

    public interface Listener {
        void onPlayerState(JSONObject state);
    }

    static volatile PlayerService instance;
    static volatile Listener listener;

    private MediaPlayer player;
    private MediaSession session;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private final List<Integer> queue = new ArrayList<>();
    private List<Integer> unshuffled = null;
    private int index = -1;
    private boolean shuffle = false;
    private String repeat = "off";
    private boolean prepared = false;
    private boolean playWhenReady = false;
    private boolean resumeOnFocusGain = false;
    private boolean foreground = false;
    private int pendingSeek = 0;
    private Bitmap currentArt;

    // Minuterie de sommeil : heure d'arret, ou arret a la fin du titre en cours.
    private long sleepAt = 0;
    private boolean sleepEndOfTrack = false;

    // Fondu enchaine (option) : le titre suivant demarre en fondu pendant que celui-ci s'eteint.
    private MediaPlayer nextPlayer;
    private boolean nextPrepared = false;
    private boolean fading = false;

    // Volume egalise : correction (dB) mesuree par le PC pour chaque titre. Baisser = setVolume ;
    // monter = LoudnessEnhancer (avec son limiteur, pas de saturation).
    private float playerVol = 1f, nextVol = 1f;
    private LoudnessEnhancer enhancer, nextEnhancer;
    // Mode Spatial : image stereo elargie (effet Virtualizer d'Android, surtout au casque).
    private Virtualizer virtualizer, nextVirtualizer;
    private int nextIndex = -1;
    private long fadeStart = 0;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (sleepAt > 0 && System.currentTimeMillis() >= sleepAt) {
                sleepAt = 0;
                pause();
                return;
            }
            crossfadeStep();
            if (isPlaying() || sleepAt > 0) handler.postDelayed(this, 250);
        }
    };

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) pause(); // ecouteurs debranches
        }
    };

    // --- Cycle de vie ---

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Lecture", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);

        session = new MediaSession(this, "Audora");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onSkipToNext() { next(false); }
            @Override public void onSkipToPrevious() { prev(); }
            @Override public void onSeekTo(long pos) { seek((int) pos); }
            @Override public void onStop() { pause(); }
        });
        session.setActive(true);
        registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        restoreQueue();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_NOT_STICKY;
        switch (intent.getAction()) {
            case ACTION_PLAY_QUEUE:
                playQueue(intent.getIntArrayExtra("ids"), intent.getIntExtra("index", 0), intent.getBooleanExtra("shuffle", false));
                break;
            case ACTION_TOGGLE: toggle(); break;
            case ACTION_PLAY: play(); break;
            case ACTION_PAUSE: pause(); break;
            case ACTION_NEXT: next(false); break;
            case ACTION_PREV: prev(); break;
            case ACTION_SEEK: seek(intent.getIntExtra("ms", 0)); break;
            case ACTION_SHUFFLE: setShuffle(!shuffle); break;
            case ACTION_REPEAT: cycleRepeat(); break;
            case ACTION_PLAY_NEXT: insertNext(intent.getIntExtra("id", -1)); break;
            case ACTION_ADD_QUEUE: addToQueue(intent.getIntExtra("id", -1)); break;
            case ACTION_JUMP: jump(intent.getIntExtra("index", -1)); break;
            case ACTION_CLEAR: clear(); break;
            case ACTION_SLEEP: setSleep(intent.getIntExtra("minutes", 0)); break;
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Appli fermee depuis les applis recentes : on arrete tout et la notification disparait.
        // (La file et la position sont gardees : la lecture reprend la ou elle en etait a la reouverture.)
        if (isPlaying()) pause();
        saveQueue();
        stopForeground(STOP_FOREGROUND_REMOVE);
        foreground = false;
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        releaseEnhancer(enhancer);
        releaseEnhancer(nextEnhancer);
        releaseEnhancer(virtualizer);
        releaseEnhancer(nextVirtualizer);
        saveQueue();
        try { unregisterReceiver(noisyReceiver); } catch (Exception ignored) { }
        handler.removeCallbacks(ticker);
        cancelCrossfade();
        if (player != null) player.release();
        session.release();
        abandonFocus();
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        instance = null;
        super.onDestroy();
    }

    // --- File d'attente ---

    private void playQueue(int[] ids, int start, boolean shuffleFlag) {
        if (ids == null || ids.length == 0) return;
        queue.clear();
        for (int id : ids) queue.add(id);
        index = Math.max(0, Math.min(start, queue.size() - 1));
        unshuffled = null;
        if (shuffleFlag) {
            shuffle = true;
            index = (int) (Math.random() * queue.size());
        }
        if (shuffle) applyShuffle();
        load(true, 0);
    }

    private void applyShuffle() {
        unshuffled = new ArrayList<>(queue);
        int current = queue.get(index);
        List<Integer> rest = new ArrayList<>(queue);
        rest.remove(index);
        Collections.shuffle(rest);
        queue.clear();
        queue.add(current);
        queue.addAll(rest);
        index = 0;
    }

    private void setShuffle(boolean on) {
        if (on == shuffle) return;
        shuffle = on;
        if (index < 0) { publish(); return; }
        if (on) {
            applyShuffle();
        } else if (unshuffled != null) {
            int current = queue.get(index);
            queue.clear();
            queue.addAll(unshuffled);
            index = Math.max(0, queue.indexOf(current));
            unshuffled = null;
        }
        saveQueue();
        publish();
    }

    private void cycleRepeat() {
        repeat = "off".equals(repeat) ? "all" : "all".equals(repeat) ? "one" : "off";
        saveQueue();
        publish();
    }

    private void insertNext(int id) {
        if (id < 0) return;
        if (index < 0) { playQueue(new int[]{id}, 0, false); return; }
        queue.add(index + 1, id);
        if (unshuffled != null) unshuffled.add(id);
        saveQueue();
        publish();
    }

    private void addToQueue(int id) {
        if (id < 0) return;
        if (index < 0) { playQueue(new int[]{id}, 0, false); return; }
        queue.add(id);
        if (unshuffled != null) unshuffled.add(id);
        saveQueue();
        publish();
    }

    private void jump(int newIndex) {
        if (newIndex < 0 || newIndex >= queue.size()) return;
        index = newIndex;
        load(true, 0);
    }

    /** Plus rien a lire (toutes les musiques supprimees) : on arrete tout. */
    private void clear() {
        cancelCrossfade();
        sleepAt = 0;
        sleepEndOfTrack = false;
        if (player != null) {
            player.release();
            player = null;
        }
        prepared = false;
        queue.clear();
        unshuffled = null;
        index = -1;
        leaveForeground();
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        abandonFocus();
        saveQueue();
        publish();
    }

    // --- Lecture ---

    private JSONObject currentTrack() {
        if (index < 0 || index >= queue.size()) return null;
        return Library.get(this).track(queue.get(index));
    }

    private void load(boolean autoplay, int seekTo) {
        JSONObject track = currentTrack();
        if (track == null) {
            // titre retire du telephone entre-temps : on passe au suivant
            if (index >= 0 && index < queue.size()) {
                queue.remove(index);
                if (index < queue.size()) load(autoplay, 0);
                else { index = queue.size() - 1; publish(); }
            }
            return;
        }
        File file = Library.get(this).audioFile(track);
        cancelCrossfade();
        releaseEnhancer(enhancer);
        enhancer = null;
        releaseEnhancer(virtualizer);
        virtualizer = null;
        if (player != null) player.release();
        prepared = false;
        playWhenReady = autoplay;
        pendingSeek = seekTo;
        player = new MediaPlayer();
        player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
        player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
        float db = normalization(track);
        playerVol = attenuation(db);
        enhancer = boost(player, db);
        virtualizer = spatial(player);
        player.setVolume(playerVol, playerVol);
        player.setOnPreparedListener(mp -> {
            prepared = true;
            if (pendingSeek > 0) mp.seekTo(pendingSeek);
            if (playWhenReady) play(); else publish();
        });
        player.setOnCompletionListener(mp -> onTrackCompleted());
        player.setOnErrorListener((mp, what, extra) -> {
            prepared = false;
            publish();
            return true;
        });
        try {
            player.setDataSource(file.getPath());
            player.prepareAsync();
        } catch (Exception e) {
            publish();
            return;
        }
        updateSessionMetadata(track);
        if (autoplay) Library.get(this).recordPlay(track.optInt("id"));
        saveQueue();
        publish();
    }

    /** Deplace un titre dans la file d'attente (glisser-deposer depuis l'appli). */
    void moveInQueue(int from, int to) {
        handler.post(() -> {
            if (from < 0 || to < 0 || from >= queue.size() || to >= queue.size() || from == to) return;
            Integer id = queue.remove(from);
            queue.add(to, id);
            if (from == index) index = to;
            else if (from < index && to >= index) index--;
            else if (from > index && to <= index) index++;
            cancelCrossfade();  // le titre suivant a peut-etre change
            saveQueue();
            publish();
        });
    }

    // --- Volume egalise ---

    private float normalization(JSONObject track) {
        if (track == null || !track.has("gain") || track.isNull("gain")) return 0f;
        if (!Library.get(this).getBool("normalize", true)) return 0f;
        return (float) track.optDouble("gain", 0);
    }

    private static float attenuation(float db) {
        return db < 0 ? (float) Math.pow(10, db / 20.0) : 1f;
    }

    private static LoudnessEnhancer boost(MediaPlayer mp, float db) {
        if (db <= 0.05f) return null;
        try {
            LoudnessEnhancer e = new LoudnessEnhancer(mp.getAudioSessionId());
            e.setTargetGain(Math.round(db * 100));  // en millibels
            e.setEnabled(true);
            return e;
        } catch (Exception e) {
            return null;  // effet indisponible sur ce telephone : volume normal
        }
    }

    private Virtualizer spatial(MediaPlayer mp) {
        if (!Library.get(this).getBool("spatial", false)) return null;
        try {
            Virtualizer v = new Virtualizer(0, mp.getAudioSessionId());
            if (v.getStrengthSupported()) v.setStrength((short) 750);
            v.setEnabled(true);
            return v;
        } catch (Exception e) {
            return null;  // effet indisponible sur ce telephone
        }
    }

    private static void releaseEnhancer(AudioEffect e) {
        if (e != null) {
            try { e.release(); } catch (Exception ignored) { }
        }
    }

    /** Reglage "Volume egalise" change : on l'applique tout de suite au titre en cours. */
    void refreshGain() {
        handler.post(() -> {
            if (player == null) return;
            float db = normalization(currentTrack());
            releaseEnhancer(enhancer);
            playerVol = attenuation(db);
            enhancer = boost(player, db);
            releaseEnhancer(virtualizer);
            virtualizer = spatial(player);
            if (!fading) player.setVolume(playerVol, playerVol);
        });
    }

    private void updateSessionMetadata(JSONObject track) {
        currentArt = null;
        File cover = Library.get(this).coverFile(track.optInt("id"));
        if (cover.exists()) currentArt = BitmapFactory.decodeFile(cover.getPath());
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, track.optString("title"))
                .putString(MediaMetadata.METADATA_KEY_ARTIST, track.optString("artist"))
                .putString(MediaMetadata.METADATA_KEY_ALBUM, track.optString("album"))
                .putLong(MediaMetadata.METADATA_KEY_DURATION, (long) (track.optDouble("duration", 0) * 1000))
                .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, currentArt)
                .build());
    }

    private void onTrackCompleted() {
        if (fading) {  // le titre suivant joue deja en fondu
            finishCrossfade();
            return;
        }
        if (sleepEndOfTrack) {
            sleepEndOfTrack = false;
            if (player != null && prepared) player.seekTo(0);
            pause();
            return;
        }
        next(true);
    }

    // --- Minuterie de sommeil ---

    /** minutes > 0 : arret dans X minutes ; -1 : a la fin du titre ; 0 : annuler. */
    private void setSleep(int minutes) {
        sleepEndOfTrack = minutes == -1;
        sleepAt = minutes > 0 ? System.currentTimeMillis() + minutes * 60_000L : 0;
        handler.removeCallbacks(ticker);
        handler.post(ticker);
        publish();
    }

    // --- Fondu enchaine ---

    private int upcomingIndex() {
        if (index + 1 < queue.size()) return index + 1;
        return "all".equals(repeat) && queue.size() > 1 ? 0 : -1;
    }

    private void crossfadeStep() {
        int seconds = Library.get(this).crossfadeSeconds();
        if (seconds <= 0 || "one".equals(repeat) || sleepEndOfTrack || !isPlaying()) {
            if (!isPlaying() || seconds <= 0) cancelCrossfade();
            return;
        }
        int fadeMs = seconds * 1000;
        int duration = player.getDuration();
        int remaining = duration - player.getCurrentPosition();
        if (duration <= fadeMs * 3) return;  // titre trop court pour un fondu
        int upcoming = upcomingIndex();
        if (upcoming < 0) return;
        if (nextPlayer == null && remaining <= fadeMs + 5000) prepareNext(upcoming);
        long now = System.currentTimeMillis();
        if (!fading && nextPrepared && remaining <= fadeMs) {
            nextPlayer.setVolume(0f, 0f);
            nextPlayer.start();
            fading = true;
            fadeStart = now;
        }
        if (fading) {
            float f = Math.min(1f, (now - fadeStart) / (float) fadeMs);
            player.setVolume((1f - f) * playerVol, (1f - f) * playerVol);
            nextPlayer.setVolume(f * nextVol, f * nextVol);
            if (f >= 1f) finishCrossfade();
        }
    }

    private void prepareNext(int upcoming) {
        JSONObject track = Library.get(this).track(queue.get(upcoming));
        if (track == null) return;
        nextIndex = upcoming;
        nextPrepared = false;
        nextPlayer = new MediaPlayer();
        nextPlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
        nextPlayer.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
        float db = normalization(track);
        nextVol = attenuation(db);
        nextEnhancer = boost(nextPlayer, db);
        nextVirtualizer = spatial(nextPlayer);
        nextPlayer.setOnPreparedListener(mp -> nextPrepared = true);
        nextPlayer.setOnErrorListener((mp, what, extra) -> {
            cancelCrossfade();
            return true;
        });
        try {
            nextPlayer.setDataSource(Library.get(this).audioFile(track).getPath());
            nextPlayer.prepareAsync();
        } catch (Exception e) {
            cancelCrossfade();
        }
    }

    /** Le titre suivant prend la place de l'actuel (fin du fondu). */
    private void finishCrossfade() {
        if (nextPlayer == null) return;
        MediaPlayer old = player;
        player = nextPlayer;
        nextPlayer = null;
        fading = false;
        nextPrepared = false;
        index = nextIndex;
        prepared = true;
        if (old != null) old.release();
        releaseEnhancer(enhancer);
        enhancer = nextEnhancer;
        nextEnhancer = null;
        releaseEnhancer(virtualizer);
        virtualizer = nextVirtualizer;
        nextVirtualizer = null;
        playerVol = nextVol;
        player.setVolume(playerVol, playerVol);
        player.setOnCompletionListener(mp -> onTrackCompleted());
        player.setOnErrorListener((mp, what, extra) -> {
            prepared = false;
            publish();
            return true;
        });
        JSONObject track = currentTrack();
        if (track != null) {
            updateSessionMetadata(track);
            Library.get(this).recordPlay(track.optInt("id"));
        }
        saveQueue();
        publish();
    }

    private void cancelCrossfade() {
        releaseEnhancer(nextEnhancer);
        nextEnhancer = null;
        releaseEnhancer(nextVirtualizer);
        nextVirtualizer = null;
        if (nextPlayer != null) {
            try { nextPlayer.release(); } catch (Exception ignored) { }
        }
        nextPlayer = null;
        nextPrepared = false;
        if (fading && player != null) {
            try { player.setVolume(playerVol, playerVol); } catch (Exception ignored) { }
        }
        fading = false;
    }

    boolean isPlaying() {
        try {
            return player != null && prepared && player.isPlaying();
        } catch (IllegalStateException e) {
            return false;
        }
    }

    private void toggle() {
        if (isPlaying()) pause(); else play();
    }

    private void play() {
        if (player == null) {
            if (index >= 0) load(true, 0);
            return;
        }
        if (!prepared) { playWhenReady = true; return; }
        if (!requestFocus()) return;
        player.start();
        goForeground();
        handler.removeCallbacks(ticker);
        handler.post(ticker);
        publish();
    }

    private void pause() {
        cancelCrossfade();
        if (player != null && prepared && player.isPlaying()) player.pause();
        playWhenReady = false;
        saveQueue();
        leaveForeground();
        publish();
    }

    private void next(boolean auto) {
        if (queue.isEmpty()) return;
        if (auto && "one".equals(repeat) && player != null) {
            player.seekTo(0);
            player.start();
            return;
        }
        if (index < queue.size() - 1) {
            index++;
            load(true, 0);
        } else if ("all".equals(repeat)) {
            index = 0;
            load(true, 0);
        } else if (auto) {
            if (player != null && prepared) player.seekTo(0);
            pause();
        }
    }

    private void prev() {
        if (queue.isEmpty()) return;
        int position = player != null && prepared ? player.getCurrentPosition() : 0;
        if (position > 3000 || index <= 0) {
            seek(0);
            return;
        }
        index--;
        load(true, 0);
    }

    private void seek(int ms) {
        cancelCrossfade();
        if (player != null && prepared) player.seekTo(Math.max(0, ms));
        publish();
    }

    // --- Focus audio (appels, autres applis) ---

    private boolean requestFocus() {
        if (focusRequest == null) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setOnAudioFocusChangeListener(this)
                    .build();
        }
        return audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonFocus() {
        if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
    }

    @Override
    public void onAudioFocusChange(int change) {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
                resumeOnFocusGain = false;
                pause();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                resumeOnFocusGain = isPlaying();
                pause();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                if (player != null) player.setVolume(0.3f * playerVol, 0.3f * playerVol);
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (player != null) player.setVolume(playerVol, playerVol);
                if (resumeOnFocusGain) play();
                resumeOnFocusGain = false;
                break;
        }
    }

    // --- Notification ---

    private PendingIntent action(String action) {
        Intent intent = new Intent(this, PlayerService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        JSONObject track = currentTrack();
        boolean playing = isPlaying();
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_audora)
                .setContentTitle(track != null ? track.optString("title") : "Audora")
                .setContentText(track != null ? track.optString("artist") : "")
                .setLargeIcon(currentArt)
                .setContentIntent(contentIntent)
                .setDeleteIntent(action(ACTION_PAUSE))
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_prev), "Précédent", action(ACTION_PREV)).build())
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, playing ? R.drawable.ic_pause : R.drawable.ic_play),
                        playing ? "Pause" : "Lecture", action(ACTION_TOGGLE)).build())
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_next), "Suivant", action(ACTION_NEXT)).build())
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        return builder.build();
    }

    private void goForeground() {
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            foreground = true;
        } catch (Exception e) {
            // Android peut refuser le premier plan depuis l'arriere-plan : on affiche au moins la notification
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        }
    }

    private void leaveForeground() {
        if (foreground) {
            stopForeground(STOP_FOREGROUND_DETACH); // la notification reste, mais peut etre balayee
            foreground = false;
        }
        if (currentTrack() != null) {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
        }
    }

    // --- Etat pour l'interface ---

    JSONObject state() {
        JSONObject s = new JSONObject();
        try {
            JSONObject track = currentTrack();
            s.put("track", track != null ? track.optInt("id") : JSONObject.NULL);
            s.put("playing", isPlaying());
            s.put("position", player != null && prepared ? player.getCurrentPosition() : pendingSeek);
            s.put("duration", player != null && prepared ? player.getDuration() : 0);
            s.put("index", index);
            JSONArray q = new JSONArray();
            for (int id : queue) q.put(id);
            s.put("queue", q);
            s.put("shuffle", shuffle);
            s.put("repeat", repeat);
            s.put("sleep_at", sleepAt);
            s.put("sleep_end_of_track", sleepEndOfTrack);
        } catch (Exception ignored) {
        }
        return s;
    }

    private void publish() {
        boolean playing = isPlaying();
        long position = player != null && prepared ? player.getCurrentPosition() : 0;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f)
                .build());
        if (foreground) getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
        Listener l = listener;
        if (l != null) l.onPlayerState(state());
    }

    // --- Sauvegarde (reprendre la ou on s'etait arrete) ---

    private void saveQueue() {
        StringBuilder ids = new StringBuilder();
        for (int id : queue) ids.append(id).append(',');
        int position = 0;
        try {
            if (player != null && prepared) position = player.getCurrentPosition();
        } catch (IllegalStateException ignored) {
        }
        getSharedPreferences("player", MODE_PRIVATE).edit()
                .putString("queue", ids.toString())
                .putInt("index", index)
                .putInt("position", position)
                .putBoolean("shuffle", shuffle)
                .putString("repeat", repeat)
                .apply();
    }

    private void restoreQueue() {
        SharedPreferences prefs = getSharedPreferences("player", MODE_PRIVATE);
        queue.clear();
        for (String part : prefs.getString("queue", "").split(",")) {
            if (!part.isEmpty()) {
                try { queue.add(Integer.parseInt(part)); } catch (NumberFormatException ignored) { }
            }
        }
        index = Math.min(prefs.getInt("index", -1), queue.size() - 1);
        shuffle = prefs.getBoolean("shuffle", false);
        repeat = prefs.getString("repeat", "off");
        if (index >= 0) load(false, prefs.getInt("position", 0));
    }
}

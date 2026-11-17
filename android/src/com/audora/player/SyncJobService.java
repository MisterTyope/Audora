package com.audora.player;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/**
 * Synchro en arriere-plan : Android la lance regulierement (environ toutes les 15 minutes)
 * quand le telephone est sur un Wi-Fi, meme si l'appli est fermee. Si le PC n'est pas
 * joignable, elle s'arrete aussitot.
 */
public class SyncJobService extends JobService {
    private static final int JOB_ID = 4711;

    public static void schedule(Context context, boolean enabled) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        if (!enabled) {
            scheduler.cancel(JOB_ID);
            return;
        }
        if (scheduler.getPendingJob(JOB_ID) != null) return;
        scheduler.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, SyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)  // Wi-Fi seulement
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)  // reprend apres un redemarrage du telephone
                .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Library lib = Library.get(this);
        if (lib.pc() == null || !lib.getBool("background_sync", true)) return false;
        new Thread(() -> {
            try {
                SyncManager.sync(this, (message, done, total) -> { });
            } catch (Exception ignored) {
                // PC eteint ou hors de la maison : on reessaiera au prochain passage
            }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}

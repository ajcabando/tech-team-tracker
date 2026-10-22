package org.opensource.tracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Resumes tracking after an in-place APK update.
 *
 * Installing an update kills the app process. [BootReceiver] only fires on
 * BOOT_COMPLETED and a sticky foreground service cannot survive a package
 * replace, so without this receiver a routine fleet update would leave every
 * phone it touched recording nothing until somebody opened the app by hand —
 * and the dashboard cannot tell that apart from a phone that is switched off.
 *
 * The guards deliberately mirror [BootReceiver]: a paired phone with the
 * background location grant is restarted, and anything else is left alone
 * rather than crash-looping. Keep the two files in step if either changes.
 *
 * Starting a `location` foreground service from a receiver is subject to
 * Android 12+ background-start restrictions. A phone that accepted the
 * battery-optimisation exemption [MainActivity] offers is explicitly exempt;
 * one that declined may have the start refused. That is why every failure path
 * falls back to the sync scheduler instead of throwing: queued points still
 * drain, and the next app launch or reboot restores tracking.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val preferences = TrackerPrefs.open(context)
        if (preferences.getString("device_token", null).isNullOrBlank()) return

        if (!hasBackgroundLocation(context)) {
            Log.w(TAG, "Not restarting after update: 'Allow all the time' location is not granted.")
            return
        }

        preferences.edit().putBoolean("tracking_enabled", true).apply()
        SyncScheduler.ensurePeriodic(context)
        startTracking(context)
    }

    private fun hasBackgroundLocation(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun startTracking(context: Context) {
        try {
            ContextCompat.startForegroundService(context, Intent(context, TrackingService::class.java))
            Log.i(TAG, "Tracking restarted after package replace")
        } catch (denied: SecurityException) {
            Log.w(TAG, "Tracking service refused after update: ${denied.message}")
            scheduleRetry(context)
        } catch (blocked: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException extends IllegalStateException:
            // the app was not allowed to become foreground from the background.
            Log.w(TAG, "Tracking service blocked after update: ${blocked.message}")
            scheduleRetry(context)
        } catch (missing: IllegalArgumentException) {
            Log.e(TAG, "Tracking service type mismatch: ${missing.message}", missing)
        }
    }

    /** WorkManager survives the update, so a queued drain keeps going either way. */
    private fun scheduleRetry(context: Context) {
        runCatching { SyncScheduler.ensurePeriodic(context) }
            .onFailure { Log.w(TAG, "Could not schedule the post-update retry", it) }
    }

    private companion object {
        const val TAG = "PackageReplaced"
    }
}

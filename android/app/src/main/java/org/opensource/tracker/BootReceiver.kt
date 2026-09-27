package org.opensource.tracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Restores tracking after a reboot whenever the phone is paired. There is no
 * technician-side off switch: a paired phone always tracks while it is on.
 * Only the administrator can break this loop, by unpairing the device.
 *
 * Starting a location foreground service from BOOT_COMPLETED is allowed: the
 * broadcast is an explicit exemption to Android's background-start restrictions,
 * and `location` is not among the types Android 15 blocks from boot receivers
 * (that list is dataSync, camera, mediaPlayback, phoneCall, mediaProjection
 * and microphone). `location` also has no runtime cap, unlike dataSync.
 *
 * What can still go wrong is the permission gate. A `location` foreground
 * service is a while-in-use type, so it needs ACCESS_BACKGROUND_LOCATION, and
 * the failure is quiet: on Android 11-13 the service starts and the notification
 * appears, but no location ever arrives; on Android 14+ it throws. So the grant
 * is checked first, and every start is guarded — a boot receiver that crashes
 * silently leaves a phone that never tracks again.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val preferences = TrackerPrefs.open(context)
        if (preferences.getString("device_token", null).isNullOrBlank()) return

        // Without this the service can come up healthy-looking and record
        // nothing at all, which is indistinguishable from a phone switched off.
        if (!hasBackgroundLocation(context)) {
            Log.w(TAG, "Not starting tracking: 'Allow all the time' location is not granted.")
            // No notification and no settings deep link are possible from a
            // receiver, so the next app launch re-offers the permission.
            return
        }

        preferences.edit().putBoolean("tracking_enabled", true).apply()
        // Scheduled uploads are independent of the foreground service, so keep
        // them running either way — a queued batch can still drain.
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
        } catch (denied: SecurityException) {
            // Thrown from API 34 when a while-in-use type is started without the
            // background grant. Guarded above, but the permission can be revoked
            // between the check and the call, and on some OEM builds the
            // background-start rules are stricter than documented.
            Log.w(TAG, "Tracking service refused at boot: ${denied.message}")
            scheduleRetry(context)
        } catch (blocked: IllegalStateException) {
            // ForegroundServiceStartNotAllowedException extends IllegalStateException.
            // The service was not allowed to become foreground right now.
            Log.w(TAG, "Tracking service blocked at boot: ${blocked.message}")
            scheduleRetry(context)
        } catch (missing: IllegalArgumentException) {
            // Thrown when the declared foreground service type does not cover
            // what the service promotes itself to.
            Log.e(TAG, "Tracking service type mismatch: ${missing.message}", missing)
        }
    }

    /**
     * A periodic worker, not an alarm. WorkManager survives reboots on its own,
     * so the retry lands once the phone has finished starting up and the usual
     * boot-time restrictions have eased.
     */
    private fun scheduleRetry(context: Context) {
        runCatching { SyncScheduler.ensurePeriodic(context) }
            .onFailure { Log.e(TAG, "Could not schedule the boot retry", it) }
    }

    private companion object {
        const val TAG = "BootReceiver"
    }
}

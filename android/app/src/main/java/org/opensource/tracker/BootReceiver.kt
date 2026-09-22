package org.opensource.tracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Restores tracking after a reboot whenever the phone is paired. There is no
 * technician-side off switch: a paired phone always tracks while it is on.
 * Only the administrator can break this loop, by unpairing the device.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val preferences = TrackerPrefs.open(context)
        if (!preferences.getString("device_token", null).isNullOrBlank()) {
            preferences.edit().putBoolean("tracking_enabled", true).apply()
            SyncScheduler.ensurePeriodic(context)
            ContextCompat.startForegroundService(context, Intent(context, TrackingService::class.java))
        }
    }
}

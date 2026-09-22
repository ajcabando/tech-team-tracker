package org.opensource.tracker.ui

import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay
import org.opensource.tracker.BatteryMonitor
import org.opensource.tracker.BuildConfig
import org.opensource.tracker.LocationDatabase
import org.opensource.tracker.R
import org.opensource.tracker.TrackerPrefs

/**
 * A read-only view of what the technician needs to see.
 *
 * Every value here is already produced by the tracking service or the server — the UI
 * only reads and formats it. Nothing in this file starts, stops or alters tracking, and
 * no value is invented: when something is unknown it is reported as unknown.
 */
data class TrackingSnapshot(
    val paired: Boolean,
    val active: Boolean,
    val moving: Boolean,
    val speedKmh: Float,
    val accuracyMeters: Float,
    val headingDegrees: Float,
    val batteryLevel: Int,
    val charging: Boolean,
    val latitude: Double,
    val longitude: Double,
    val lastUpdateMillis: Long,
    val distanceTodayKm: Float,
    val tripsToday: Int,
    val pendingUploads: Int,
    val online: Boolean,
    val startedAtMillis: Long,
) {
    /** A fix is considered current if the service delivered a point recently. */
    val hasFix: Boolean
        get() = lastUpdateMillis > 0L && System.currentTimeMillis() - lastUpdateMillis < 90_000L

    val hasPosition: Boolean
        get() = latitude != 0.0 || longitude != 0.0
}

private fun SharedPreferences.floatOrZero(key: String): Float = runCatching { getFloat(key, 0f) }.getOrDefault(0f)

/** Reads one consistent snapshot. Cheap enough to poll once a second. */
fun readTrackingSnapshot(context: Context, prefs: SharedPreferences, pending: Int): TrackingSnapshot = TrackingSnapshot(
    paired = prefs.getString("device_token", null) != null,
    active = prefs.getBoolean("tracking_active", false),
    moving = prefs.getBoolean("trip_moving", false),
    speedKmh = prefs.floatOrZero("last_speed"),
    accuracyMeters = prefs.floatOrZero("last_accuracy"),
    headingDegrees = prefs.floatOrZero("last_heading"),
    batteryLevel = prefs.getInt("last_battery", 0).let { if (it > 0) it else context.safeBatteryLevel() },
    charging = BatteryMonitor.isCharging(context),
    latitude = prefs.floatOrZero("last_latitude").toDouble(),
    longitude = prefs.floatOrZero("last_longitude").toDouble(),
    lastUpdateMillis = prefs.getLong("last_update", 0L),
    distanceTodayKm = prefs.floatOrZero("trip_distance_today_km"),
    tripsToday = prefs.getInt("today_trip_count", 0),
    pendingUploads = pending,
    online = isOnline(context),
    startedAtMillis = prefs.getLong("tracking_started_at", 0L),
)

private fun Context.safeBatteryLevel(): Int = runCatching { BatteryMonitor.level(this) }.getOrDefault(0)

/**
 * Watches the tracking state. The position values are written by the foreground service
 * roughly once per GPS fix, so a one-second poll shows changes as they arrive while
 * costing almost nothing.
 */
@Composable
fun rememberTrackingSnapshot(pollMillis: Long = 1_000L): TrackingSnapshot {
    val context = LocalContext.current
    val prefs = remember { TrackerPrefs.open(context) }
    var pending by remember { mutableStateOf(0) }
    var snapshot by remember { mutableStateOf(readTrackingSnapshot(context, prefs, 0)) }

    LaunchedEffect(prefs) {
        while (true) {
            snapshot = readTrackingSnapshot(context, prefs, pending)
            delay(pollMillis)
        }
    }
    // The offline queue lives in Room, so it is counted on its own slower cadence.
    LaunchedEffect(prefs) {
        while (true) {
            runCatching { LocationDatabase.create(context).locations().count() }.onSuccess { pending = it }
            delay(3_000L)
        }
    }
    return snapshot
}

/** Whether the phone currently has a usable network connection. */
fun isOnline(context: Context): Boolean {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
    val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
}

/** Identity shown on the settings and about screens. Read once per screen. */
data class DeviceIdentity(
    val appName: String,
    val tagline: String,
    val technicianName: String?,
    val deviceId: String?,
    val serverUrl: String?,
    val appVersion: String,
)

fun readDeviceIdentity(context: Context): DeviceIdentity {
    val prefs = TrackerPrefs.open(context)
    return DeviceIdentity(
        appName = prefs.getString("application_name", null) ?: context.getString(R.string.app_name),
        tagline = context.getString(R.string.app_tagline),
        technicianName = prefs.getString("technician_name", null),
        deviceId = prefs.getString("device_id", null),
        serverUrl = prefs.getString("api_url", null),
        appVersion = BuildConfig.VERSION_NAME,
    )
}

/** The branded application name, used by the header and the tracking notification. */
fun configuredAppName(context: Context): String =
    runCatching { TrackerPrefs.open(context).getString("application_name", null) }.getOrNull()
        ?: context.getString(R.string.app_name)

package org.opensource.tracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Foreground location service. It is independent of the UI and keeps recording with the
 * screen off or while other apps are in the foreground. Intervals adapt to movement and
 * battery state to limit battery impact; the persistent notification makes tracking
 * visible at all times (there is no stealth mode).
 */
class TrackingService : Service() {
    private lateinit var locationClient: FusedLocationProviderClient
    private lateinit var database: LocationDatabase
    private lateinit var preferences: android.content.SharedPreferences
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val tripDetector = TripDetector()

    private var settings = TrackingSettings()
    private var currentIntervalMs = 0L
    private var currentPriority = -1
    private var lastNotificationText = ""
    private var lastNotifiedMoving = false
    private var lastNotifyAt = 0L

    override fun onCreate() {
        super.onCreate()
        locationClient = LocationServices.getFusedLocationProviderClient(this)
        database = LocationDatabase.create(this)
        preferences = TrackerPrefs.open(this)
        createNotificationChannel()
        preferences.edit()
            .putBoolean("tracking_active", true)
            .putLong("tracking_started_at", System.currentTimeMillis())
            .putFloat("trip_distance_today_km", 0f)
            .putInt("today_trip_count", 0)
            .apply()
        tripDetector.reset()
        startForeground(NOTIFICATION_ID, notification("Tracking Active", "Starting GPS…"))
        scheduleSync()
        refreshConfig()
        adjustTracking(BatteryMonitor.level(this), BatteryMonitor.isCharging(this))
    }

    /** Pull adaptive intervals, branding, and technician identity from the server. */
    private fun refreshConfig() {
        scope.launch { enforceServerState() }
        scheduleEnforcement()
    }

    /**
     * Re-checks with the server every 15 minutes. A device the administrator
     * disabled or unpaired stops itself here: uploads would be rejected anyway,
     * so recording locally any longer only wastes battery. Network errors are
     * ignored — the phone keeps recording offline and uploads later.
     */
    private fun scheduleEnforcement() {
        scope.launch {
            while (true) {
                delay(15 * 60_000L)
                enforceServerState()
            }
        }
    }

    private suspend fun enforceServerState() {
        val api = TrackerApi(this@TrackingService)
        try {
            val config = api.config().getOrThrow()
            if (config.status != "ACTIVE") {
                disableByServer()
                return
            }
            settings = config.settings
            preferences.edit()
                .putString("application_name", config.applicationName ?: preferences.getString("application_name", null))
                .putString("technician_name", config.technicianName)
                .apply()
            adjustTracking(BatteryMonitor.level(this@TrackingService), BatteryMonitor.isCharging(this@TrackingService))
        } catch (revoked: DeviceRevokedException) {
            disableByServer()
        } catch (_: Exception) {
            // Offline or server error: keep recording, uploads retry later.
        }
    }

    /**
     * The administrator disabled or unpaired this phone. Stop recording, drop the
     * credential so the app returns to pairing, and keep the queued points.
     */
    private fun disableByServer() {
        locationClient.removeLocationUpdates(callback)
        preferences.edit()
            .putBoolean("tracking_enabled", false)
            .putBoolean("tracking_active", false)
            .remove("device_token")
            .remove("technician_id")
            .remove("technician_name")
            .remove("device_id")
            .apply()
        stopSelf()
    }

    private fun requestLocationUpdates() {
        val interval = currentIntervalMs
        val priority = currentPriority
        val request = LocationRequest.Builder(priority, interval)
            .setMinUpdateIntervalMillis(maxOf(5_000L, interval / 2))
            // Batch delivery lets the chipset and CPU sleep between windows instead of
            // waking per fix; the callback already iterates every delivered location.
            .setMaxUpdateDelayMillis(interval * 4)
            // Suppress drift fixes while standing still: fewer junk points stored/uploaded.
            .setMinUpdateDistanceMeters(if (priority == Priority.PRIORITY_HIGH_ACCURACY) 10f else 25f)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            locationClient.requestLocationUpdates(request, callback, mainLooper)
        } catch (_: SecurityException) {
            stopSelf()
        }
    }

    /** Choose interval/priority from movement state and battery, restarting only on change. */
    private fun adjustTracking(battery: Int, charging: Boolean) {
        val lowBattery = battery in 1 until settings.lowBatteryThreshold && !charging
        val moving = preferences.getBoolean("trip_moving", false)
        val intervalSeconds = when {
            lowBattery -> settings.lowBatteryIntervalSeconds
            moving -> settings.movingIntervalSeconds
            else -> settings.stationaryIntervalSeconds
        }
        val interval = intervalSeconds * 1000L
        val priority = when {
            lowBattery -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
            moving -> Priority.PRIORITY_HIGH_ACCURACY
            else -> Priority.PRIORITY_BALANCED_POWER_ACCURACY
        }
        if (interval == currentIntervalMs && priority == currentPriority) return
        currentIntervalMs = interval
        currentPriority = priority
        requestLocationUpdates()
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            for (location in result.locations) handleFix(location)
        }
    }

    private fun handleFix(location: android.location.Location) {
        val battery = BatteryMonitor.level(this)
        val charging = BatteryMonitor.isCharging(this)
        // Drop junk fixes (indoors, urban canyons) before they cost a DB write and
        // an upload: the server filters these anyway, so nothing of value is lost.
        val accuracyThreshold = settings.gpsAccuracyThresholdMeters.toFloat()
        if (location.hasAccuracy() && location.accuracy > accuracyThreshold) return

        val speedKmh = location.speed * 3.6f
        val update = tripDetector.onFix(location.latitude, location.longitude, location.speed, location.time)

        scope.launch {
            database.locations().insert(
                LocationEntity(
                    id = UUID.randomUUID().toString(),
                    deviceId = preferences.getString("device_id", "").orEmpty(),
                    recordedAt = if (location.time > 0) location.time else System.currentTimeMillis(),
                    latitude = location.latitude,
                    longitude = location.longitude,
                    speed = speedKmh,
                    heading = location.bearing,
                    accuracy = location.accuracy,
                    altitude = location.altitude,
                    battery = battery,
                    networkState = networkState()
                )
            )
            // Ask the sync worker to flush promptly while we are on the network.
            SyncScheduler.requestImmediate(this@TrackingService)
        }

        val distanceToday = preferences.getFloat("trip_distance_today_km", 0f) + (update.distanceDeltaMeters / 1000f).toFloat()
        val editor = preferences.edit()
            .putFloat("last_speed", speedKmh)
            .putFloat("last_accuracy", location.accuracy)
            .putFloat("last_heading", location.bearing)
            .putInt("last_battery", battery)
            .putFloat("last_latitude", location.latitude.toFloat())
            .putFloat("last_longitude", location.longitude.toFloat())
            .putLong("last_update", System.currentTimeMillis())
            .putBoolean("trip_moving", update.state == TripDetector.State.MOVING)
            .putFloat("trip_distance_today_km", if (update.state == TripDetector.State.MOVING) distanceToday else preferences.getFloat("trip_distance_today_km", 0f))
        if (update.tripStarted) editor.putInt("today_trip_count", preferences.getInt("today_trip_count", 0) + 1)
        editor.apply()

        // Presentation only: the notification keeps the technician informed without
        // changing how or when location updates are collected. Throttled to state
        // changes or one refresh a minute — every fix would otherwise re-notify.
        val moving = update.state == TripDetector.State.MOVING
        val now = System.currentTimeMillis()
        if (moving != lastNotifiedMoving || now - lastNotifyAt >= 60_000L) {
            lastNotifiedMoving = moving
            lastNotifyAt = now
            updateNotification(
                title = if (moving) "Tracking Active · Moving" else "Tracking Active · Stopped",
                detail = "Speed ${speedKmh.toInt()} km/h · Battery $battery%",
            )
        }
        adjustTracking(battery, charging)
    }

    private fun networkState(): String {
        val manager = getSystemService(ConnectivityManager::class.java)
        val capabilities = manager?.getNetworkCapabilities(manager.activeNetwork)
        return when {
            capabilities == null -> "offline"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "connected"
        }
    }

    private fun scheduleSync() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("location-sync", ExistingPeriodicWorkPolicy.KEEP, request)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(NotificationChannel(CHANNEL_ID, "Tracking", NotificationManager.IMPORTANCE_LOW))
        }
    }

    /**
     * The persistent tracking notification. It is mandatory for a foreground location
     * service and is deliberately always visible: there is no stealth mode. It opens
     * the app and offers no stop action — only the administrator can deactivate
     * tracking, from the dashboard or with the device admin password on the phone.
     */
    private fun notification(title: String, detail: String): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val appName = preferences.getString("application_name", null) ?: getString(R.string.app_name)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(appName)
            .setContentText(title)
            .setSubText(detail)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(this, R.color.tracker_primary))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp)
            .build()
    }

    private fun updateNotification(title: String, detail: String) {
        val text = "$title|$detail"
        if (text == lastNotificationText) return
        lastNotificationText = text
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(title, detail))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        preferences.edit().putBoolean("tracking_active", false).apply()
        locationClient.removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "org.opensource.tracker.START"
        private const val CHANNEL_ID = "tracking"
        private const val NOTIFICATION_ID = 10
    }
}

package org.opensource.tracker

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import org.opensource.tracker.ui.TrackerApp

/**
 * Hosts the technician interface.
 *
 * The activity keeps only the responsibilities that genuinely need an Activity or a
 * Service: runtime permissions, starting the foreground tracking service, device
 * pairing, and applying administrator actions from the phone's locked settings.
 * There is deliberately no stop and no sign-out: a paired phone tracks whenever it
 * is on, and only the administrator can deactivate it. Everything about how the app
 * looks lives in [TrackerApp] and the `ui` package, and all tracking behaviour
 * stays in [TrackingService].
 */
class MainActivity : ComponentActivity() {
    private lateinit var pairingManager: PairingManager

    /** Mirrors whether this phone has been paired; flips on pairing and on unpair. */
    private val paired = mutableStateOf(false)

    /** The server URL shown on the pairing screen; updated when an admin changes it. */
    private val server = mutableStateOf("")

    private val foregroundLocationRequest =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (hasLocation()) requestNotificationPermission()
        }

    private val notificationRequest =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) requestBackgroundPermission()
        }

    private val backgroundLocationRequest =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startTracking()
        }

    private val backgroundSettingsRequest =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            if (hasBackgroundLocation()) startTracking()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        pairingManager = PairingManager(this)
        SyncScheduler.ensurePeriodic(this)

        val preferences = TrackerPrefs.open(this)
        paired.value = preferences.getString("device_token", null) != null

        // Read the branding and build details once; the app name is refreshed after the
        // service pulls it from the server.
        val initialAppName = preferences.getString("application_name", null) ?: getString(R.string.app_name)
        server.value = preferences.getString("api_url", null) ?: DEFAULT_SERVER
        val tagline = getString(R.string.app_tagline)
        val version = appVersion()

        // A paired phone always tracks while it is on: resume immediately on open.
        if (paired.value) requestPermissions()

        setContent {
            TrackerApp(
                initialAppName = initialAppName,
                tagline = tagline,
                version = version,
                initialServer = server.value,
                paired = paired.value,
                onPair = ::pair,
                onServerChanged = ::changeServer,
                onUnpaired = ::handleRemoteUnpair,
                onDarkScreenChange = ::applySystemBarStyle,
            )
        }
    }

    private fun hasLocation(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasNotifications(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun hasBackgroundLocation(): Boolean =
        Build.VERSION.SDK_INT < 29 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    /**
     * Permission groups are requested in the order required by modern Android. Tracking
     * starts only after the technician can see its persistent notification and has chosen
     * to allow location while the app is not open.
     */
    private fun requestPermissions() {
        if (!hasLocation()) {
            foregroundLocationRequest.launch(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ))
        } else {
            requestNotificationPermission()
        }
    }

    private fun requestNotificationPermission() {
        if (hasNotifications()) {
            requestBackgroundPermission()
        } else if (Build.VERSION.SDK_INT >= 33) {
            notificationRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun requestBackgroundPermission() {
        if (hasBackgroundLocation()) {
            startTracking()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Allow tracking while using other apps")
            .setMessage("Tracking stays visible in a persistent notification. Choose Allow all the time so trips continue when this app is not on screen.")
            .setNegativeButton("Not now", null)
            .setPositiveButton("Continue") { _, _ ->
                if (Build.VERSION.SDK_INT >= 30) {
                    backgroundSettingsRequest.launch(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
                    )
                } else {
                    backgroundLocationRequest.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }
            }
            .show()
    }

    private fun startTracking() {
        TrackerPrefs.open(this).edit().putBoolean("tracking_enabled", true).apply()
        SyncScheduler.ensurePeriodic(this)
        ContextCompat.startForegroundService(this, Intent(this, TrackingService::class.java))
    }

    /**
     * Drops the local pairing state and returns to the pairing screen. The service
     * is stopped first so it cannot keep uploading. The server URL and device UUID
     * are kept, so pairing again only needs a new code. Recorded history is untouched.
     */
    private fun clearPairing() {
        stopService(Intent(this, TrackingService::class.java))
        TrackerPrefs.open(this).edit()
            .remove("device_token")
            .remove("technician_id")
            .remove("technician_name")
            .remove("device_id")
            .putBoolean("tracking_active", false)
            .putBoolean("tracking_enabled", false)
            .apply()
        paired.value = false
    }

    /**
     * The administrator changed the server address on the phone's locked settings.
     * Credentials belong to the old server, so the phone must be paired again.
     */
    private fun changeServer(url: String) {
        clearPairing()
        TrackerPrefs.open(this).edit().putString("api_url", url).apply()
        server.value = url
    }

    /** The administrator unpaired this phone from its locked settings. */
    private fun handleRemoteUnpair() {
        clearPairing()
    }

    private fun pair(url: String, code: String, result: (Result<String>) -> Unit) =
        pairingManager.pair(url, code) { outcome ->
            if (outcome.isSuccess) {
                paired.value = true
                requestPermissions()
            }
            result(outcome)
        }

    /** Dark screens (splash, tracking dashboard) need light status bar icons. */
    private fun applySystemBarStyle(dark: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
    }

    private fun appVersion(): String = BuildConfig.VERSION_NAME

    private companion object {
        /** The emulator's loopback address; a real phone uses the server's LAN or HTTPS address. */
        val DEFAULT_SERVER = if (BuildConfig.DEBUG) "http://10.0.2.2:5789" else ""
    }
}

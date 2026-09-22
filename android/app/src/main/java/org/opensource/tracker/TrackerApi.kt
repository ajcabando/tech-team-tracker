package org.opensource.tracker

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** The server rejected the device credential: the administrator unpaired or disabled it. */
class DeviceRevokedException(message: String) : Exception(message)

internal fun normalizeServerUrl(rawUrl: String): String {
    val url = runCatching { URL(rawUrl.trim()) }.getOrElse { error("Enter a valid server address") }
    val secure = url.protocol.equals("https", ignoreCase = true)
    val debugEmulator = BuildConfig.DEBUG &&
        url.protocol.equals("http", ignoreCase = true) &&
        url.host == "10.0.2.2"
    require(secure || debugEmulator) { "The server must use HTTPS" }
    require(url.userInfo == null) { "The server address must not contain credentials" }
    return url.toExternalForm().trimEnd('/')
}

data class TripSummary(
    val id: String,
    val startedAt: String,
    val endedAt: String?,
    val distanceMeters: Double,
    val drivingSeconds: Int,
    val maxSpeed: Double,
    val averageSpeed: Double,
    val stopCount: Int
)

data class RoutePoint(
    val latitude: Double,
    val longitude: Double,
    val recordedAt: String,
    val speed: Double?,
    val heading: Float?,
    val elapsedSeconds: Double,
    val cumulativeDistanceMeters: Double,
)

data class TrackingSettings(
    val movingIntervalSeconds: Long = 5,
    val walkingIntervalSeconds: Long = 20,
    val stationaryIntervalSeconds: Long = 45,
    val lowBatteryIntervalSeconds: Long = 90,
    val stopTimeoutSeconds: Int = 300,
    val automaticTripDetection: Boolean = true,
    val gpsAccuracyThresholdMeters: Double = 100.0,
    val lowBatteryThreshold: Int = 20
)

data class DeviceConfig(
    val deviceId: String,
    val status: String,
    val technicianName: String?,
    val technicianEmployeeNumber: String?,
    val settings: TrackingSettings,
    val applicationName: String?
)

/**
 * Talks to the backend using the short-lived device token obtained during pairing.
 * The token is deliberately never a user credential: it can only read its own config
 * and upload GPS points.
 */
class TrackerApi(private val context: Context) {
    private val preferences = TrackerPrefs.open(context)
    private fun connection(path: String): HttpURLConnection {
        val base = normalizeServerUrl(preferences.getString("api_url", null) ?: error("Device is not paired"))
        val token = preferences.getString("device_token", null) ?: error("Device is not paired")
        return (URL("${base.trimEnd('/')}$path").openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Authorization", "Bearer $token")
        }
    }

    suspend fun config(): Result<DeviceConfig> = withContext(Dispatchers.IO) {
        runCatching {
            val request = connection("/api/device/config")
            if (request.responseCode == 401 || request.responseCode == 403) {
                throw DeviceRevokedException("This device was unpaired by the administrator")
            }
            if (request.responseCode !in 200..299) error("Unable to load device configuration")
            val row = org.json.JSONObject(request.inputStream.bufferedReader().use { it.readText() })
            val tracking = row.optJSONObject("tracking")
            val branding = row.optJSONObject("branding")
            val technician = row.optJSONObject("technician")
            DeviceConfig(
                deviceId = row.getString("deviceId"),
                status = row.getString("status"),
                technicianName = technician?.optString("name"),
                technicianEmployeeNumber = technician?.optString("employeeNumber"),
                settings = TrackingSettings(
                    movingIntervalSeconds = tracking?.optLong("movingIntervalSeconds", 5) ?: 5,
                    walkingIntervalSeconds = tracking?.optLong("walkingIntervalSeconds", 20) ?: 20,
                    stationaryIntervalSeconds = tracking?.optLong("stationaryIntervalSeconds", 45) ?: 45,
                    lowBatteryIntervalSeconds = tracking?.optLong("lowBatteryIntervalSeconds", 90) ?: 90,
                    stopTimeoutSeconds = tracking?.optInt("stopTimeoutSeconds", 300) ?: 300,
                    automaticTripDetection = tracking?.optBoolean("automaticTripDetection", true) ?: true,
                    gpsAccuracyThresholdMeters = tracking?.optDouble("gpsAccuracyThresholdMeters", 100.0) ?: 100.0,
                    lowBatteryThreshold = tracking?.optInt("lowBatteryThreshold", 20) ?: 20
                ),
                applicationName = branding?.optString("applicationName")
            )
        }
    }

    /**
     * Verifies the device admin password (the password-only gate on the phone's
     * settings). On success the server unlocks privileged on-phone actions for
     * a few minutes; the phone itself never decides what the password is.
     */
    suspend fun verifyAdmin(password: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val request = connection("/api/device/verify-admin").apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            request.outputStream.use { it.write(JSONObject().put("password", password).toString().toByteArray()) }
            if (request.responseCode !in 200..299) error(request.errorMessage())
        }
    }

    /**
     * Unpairs this phone. The server must have unlocked the device first via
     * [verifyAdmin]; otherwise it answers 403 and nothing changes.
     */
    suspend fun unpairDevice(): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val request = connection("/api/device/unpair").apply {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            request.outputStream.use { it.write("{}".toByteArray()) }
            if (request.responseCode !in 200..299) error(request.errorMessage())
        }
    }

    private fun HttpURLConnection.errorMessage(): String = runCatching {
        JSONObject((errorStream ?: inputStream).bufferedReader().use { it.readText() })
            .optString("error")
    }.getOrDefault("").ifBlank { "Request failed (${responseCode})" }

    suspend fun trips(): Result<List<TripSummary>> = withContext(Dispatchers.IO) {
        runCatching {
            val request = connection("/api/device/trips")
            if (request.responseCode !in 200..299) error("Unable to load trips")
            val rows = JSONArray(request.inputStream.bufferedReader().use { it.readText() })
            buildList {
                for (index in 0 until rows.length()) {
                    val row = rows.getJSONObject(index)
                    add(
                        TripSummary(
                            id = row.getString("id"),
                            startedAt = row.getString("startedAt"),
                            endedAt = if (row.isNull("endedAt")) null else row.getString("endedAt"),
                            distanceMeters = row.optDouble("distanceMeters", 0.0),
                            drivingSeconds = row.optInt("drivingSeconds", 0),
                            maxSpeed = row.optDouble("maxSpeed", 0.0),
                            averageSpeed = row.optDouble("averageSpeed", 0.0),
                            stopCount = row.optInt("stopCount", 0)
                        )
                    )
                }
            }
        }
    }

    suspend fun route(tripId: String): Result<List<RoutePoint>> = withContext(Dispatchers.IO) {
        runCatching {
            val request = connection("/api/device/trips/${Uri.encode(tripId)}/replay")
            if (request.responseCode !in 200..299) error("Unable to load route")
            val rows = JSONArray(request.inputStream.bufferedReader().use { it.readText() })
            buildList {
                for (index in 0 until rows.length()) {
                    val row = rows.getJSONObject(index)
                    add(
                        RoutePoint(
                            latitude = row.getDouble("latitude"),
                            longitude = row.getDouble("longitude"),
                            recordedAt = row.getString("recordedAt"),
                            speed = if (row.isNull("speed")) null else row.getDouble("speed"),
                            heading = if (row.isNull("heading")) null else row.getDouble("heading").toFloat(),
                            elapsedSeconds = row.getDouble("elapsedSeconds"),
                            cumulativeDistanceMeters = row.getDouble("cumulativeDistanceMeters"),
                        )
                    )
                }
            }
        }
    }
}

package org.opensource.tracker

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlin.concurrent.thread

class PairingManager(private val context: Context) {
    // Pairing writes the device token, so credentials go to encrypted storage.
    private val preferences = TrackerPrefs.open(context)
    private val main = Handler(Looper.getMainLooper())

    fun pair(apiUrl: String, code: String, onResult: (Result<String>) -> Unit) {
        thread {
            try {
                val serverUrl = normalizeServerUrl(apiUrl)
                val deviceUuid = preferences.getString("device_uuid", null) ?: UUID.randomUUID().toString().also {
                    preferences.edit().putString("device_uuid", it).apply()
                }
                val connection = (URL("$serverUrl/api/devices/pair").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                connection.outputStream.use { it.write(JSONObject().apply {
                    put("code", code.trim())
                    put("deviceUuid", deviceUuid)
                    put("manufacturer", android.os.Build.MANUFACTURER)
                    put("model", android.os.Build.MODEL)
                    put("androidVersion", android.os.Build.VERSION.RELEASE)
                    put("appVersion", BuildConfig.VERSION_NAME)
                }.toString().toByteArray()) }
                val body = (if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream)
                    .bufferedReader().use { it.readText() }
                if (connection.responseCode !in 200..299) error(JSONObject(body).optString("error", "Pairing failed"))
                val result = JSONObject(body)
                preferences.edit()
                    .putString("device_id", result.getString("deviceId"))
                    .putString("technician_id", result.optString("technicianId", ""))
                    .putString("device_token", result.getString("deviceToken"))
                    .putString("api_url", serverUrl)
                    .apply()
                main.post { onResult(Result.success(result.getString("deviceId"))) }
            } catch (error: Throwable) {
                main.post { onResult(Result.failure(error)) }
            }
        }
    }
}

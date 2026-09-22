package org.opensource.tracker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Uploads the Room offline queue to the backend. Points stay on the phone until the
 * server confirms them, and every point carries a UUID so a retried upload cannot
 * create duplicates.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val preferences = TrackerPrefs.open(applicationContext)
        val apiUrl = preferences.getString("api_url", null)
        val token = preferences.getString("device_token", null)
        if (apiUrl.isNullOrBlank() || token.isNullOrBlank()) return@withContext Result.failure()
        val serverUrl = runCatching { normalizeServerUrl(apiUrl) }.getOrElse { return@withContext Result.failure() }

        val database = LocationDatabase.create(applicationContext)
        val pending = database.locations().pending(limit = 500)
        if (pending.isEmpty()) {
            preferences.edit().putLong("last_sync_at", System.currentTimeMillis()).apply()
            return@withContext Result.success()
        }

        val body = JSONObject().put("points", JSONArray().apply {
            pending.forEach { point ->
                put(JSONObject().apply {
                    put("id", point.id)
                    put("recordedAt", java.time.Instant.ofEpochMilli(point.recordedAt).toString())
                    put("latitude", point.latitude)
                    put("longitude", point.longitude)
                    point.speed?.let { put("speed", it / 3.6f) } // server stores km/h; send m/s
                    point.heading?.let { put("heading", it) }
                    point.accuracy?.let { put("accuracy", it) }
                    point.altitude?.let { put("altitude", it) }
                    point.battery?.let { put("battery", it) }
                    put("networkState", point.networkState ?: "unknown")
                })
            }
        }).toString()

        try {
            val connection = (URL("$serverUrl/api/locations/batch").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 20_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }
            connection.outputStream.use { it.write(body.toByteArray()) }
            when (connection.responseCode) {
                in 200..299 -> {
                    // The server accepted this batch (idempotently). Safe to prune locally.
                    database.locations().delete(pending.map { it.id })
                    database.locations().pruneToLatest()
                    preferences.edit()
                        .putLong("last_sync_at", System.currentTimeMillis())
                        .putInt("pending_sync_count", database.locations().count())
                        .apply()
                    Result.success()
                }
                401, 403 -> {
                    // Credentials were revoked (device unpaired). Keep the data, stop retrying.
                    Result.failure()
                }
                else -> Result.retry()
            }
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

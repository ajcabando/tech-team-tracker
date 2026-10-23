package org.opensource.tracker

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Downloads a published release and hands it to Android's package installer.
 *
 * Deliberately narrow: it never decides that an update is allowed (the server does
 * that when the admin password is verified), and it never installs anything without
 * the user confirming in the system installer. Its only job is to make sure the
 * bytes the installer sees are exactly the bytes the server described — a partial
 * file is never renamed into place, so an interrupted download or a hash mismatch
 * cannot reach the installer.
 */
object ApkUpdater {
    /** Android installs an update only when its versionCode is strictly higher. */
    fun updateAvailable(release: ReleaseInfo?, installedVersionCode: Int = BuildConfig.VERSION_CODE): Boolean =
        release != null && release.versionCode > installedVersionCode

    /** True when Android will let this app open the package installer at all. */
    fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /**
     * Opens the per-app "install unknown apps" screen. An app that was sideloaded
     * from a browser does not automatically have the right to install its own
     * update, so an administrator grants this once on each phone.
     */
    fun openInstallPermissionSettings(context: Context): Result<Unit> = runCatching {
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    /**
     * Downloads [release] into private storage and verifies size and SHA-256.
     *
     * Re-running reuses an already verified file: the unknown-sources round trip
     * leaves the app and returns, and re-downloading a ~20 MB APK for that is
     * pointless. Any other file in the updates directory is removed afterwards so
     * old builds do not accumulate on a tracking phone.
     */
    suspend fun download(
        context: Context,
        release: ReleaseInfo,
        onProgress: (Float) -> Unit = {},
    ): Result<File> = withContext(Dispatchers.IO) {
        runCatching {
            require(release.sha256.isNotBlank()) { "The server did not describe this release" }
            val directory = File(context.filesDir, "updates").apply { mkdirs() }
            val target = File(directory, "tracker-${release.versionCode}.apk")
            if (isVerified(target, release)) return@runCatching target

            val base = TrackerPrefs.open(context).getString("api_url", null) ?: error("Device is not paired")
            val url = URL("${base.trimEnd('/')}${release.downloadPath}")
            val partial = File(directory, "${target.name}.part")
            partial.delete()

            val connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 30_000
            }
            try {
                if (connection.responseCode !in 200..299) error("Unable to download the update (${connection.responseCode})")
                val expected = if (release.sizeBytes > 0) release.sizeBytes else connection.contentLengthLong
                val digest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                connection.inputStream.use { input ->
                    partial.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            total += read
                            if (expected > 0) onProgress((total.toFloat() / expected).coerceIn(0f, 1f))
                        }
                    }
                }
                if (expected > 0 && total != expected) error("The update download was incomplete")
                if (!sha256Hex(digest.digest()).equals(release.sha256, ignoreCase = true)) {
                    error("The update download failed its integrity check")
                }
                if (!partial.renameTo(target)) error("Could not store the update")
                directory.listFiles()?.forEach { file -> if (file != target) file.delete() }
                onProgress(1f)
                target
            } finally {
                partial.delete()
                connection.disconnect()
            }
        }
    }

    private fun isVerified(file: File, release: ReleaseInfo): Boolean {
        if (!file.isFile) return false
        if (release.sizeBytes > 0 && file.length() != release.sizeBytes) return false
        return runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
            sha256Hex(digest.digest()).equals(release.sha256, ignoreCase = true)
        }.getOrDefault(false)
    }

    /** `%02x` on a signed Byte would print "ff" only by accident; mask to 0..255. */
    private fun sha256Hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }

    /**
     * Opens the system installer for a verified file through a FileProvider URI.
     * The app process is replaced if the administrator confirms, and
     * [PackageReplacedReceiver] restarts tracking.
     */
    fun install(context: Context, file: File): Result<Unit> = runCatching {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            // Only needed when the caller is not an Activity; the installer is then
            // launched into its own task.
            if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}

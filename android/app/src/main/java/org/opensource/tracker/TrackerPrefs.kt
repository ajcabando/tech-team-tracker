package org.opensource.tracker

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Credentials (device token, technician id, server URL) are sensitive: they authorize
 * GPS uploads. They are stored in an AES-256 encrypted preferences file backed by the
 * Android keystore. If secure storage is unavailable, callers fail closed rather than
 * exposing the device credential in plaintext.
 */
object TrackerPrefs {
    const val FILE = "tracker"

    fun open(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }
}

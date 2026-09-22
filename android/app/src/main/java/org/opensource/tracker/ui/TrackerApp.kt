package org.opensource.tracker.ui

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay
import org.opensource.tracker.ui.screens.AdminGateScreen
import org.opensource.tracker.ui.screens.AdminSettingsScreen
import org.opensource.tracker.ui.screens.PairingScreen
import org.opensource.tracker.ui.screens.SplashScreen
import org.opensource.tracker.ui.screens.TrackingHomeScreen

/**
 * Root of the Tech Team Tracker interface.
 *
 * The activity owns pairing, permissions and the tracking service; this composable owns
 * presentation only: which screen is showing, the shared tracking snapshot every screen
 * reads from, and the dark/light system bar style each page needs.
 *
 * The technician flow is minimal on purpose: splash, pairing, then a status screen.
 * A small settings icon opens the admin password gate; everything privileged lives
 * behind it. There is no bottom navigation and no way to stop tracking on the phone.
 */
@Composable
fun TrackerApp(
    initialAppName: String,
    tagline: String,
    version: String,
    initialServer: String,
    paired: Boolean,
    onPair: (server: String, code: String, onResult: (Result<String>) -> Unit) -> Unit,
    onServerChanged: (server: String) -> Unit,
    onUnpaired: () -> Unit,
    onDarkScreenChange: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    var splashVisible by remember { mutableStateOf(true) }
    var page by remember { mutableStateOf(TrackerPage.STATUS) }
    var adminUnlocked by remember { mutableStateOf(false) }
    // Branding arrives from the server when tracking starts, so it can change at runtime.
    var appName by remember { mutableStateOf(initialAppName) }

    val snapshot = rememberTrackingSnapshot()

    LaunchedEffect(Unit) {
        delay(900L)
        splashVisible = false
    }

    LaunchedEffect(snapshot.active) {
        if (!snapshot.active) return@LaunchedEffect
        delay(2_000L)
        runCatching { configuredAppName(context) }.onSuccess { appName = it }
    }

    // Losing the pairing (unpair here or revoked by the administrator) returns to the
    // pairing screen and drops any unlocked admin state.
    LaunchedEffect(paired) {
        if (!paired) {
            adminUnlocked = false
            page = TrackerPage.STATUS
        }
    }

    val current = when {
        splashVisible -> TrackerPage.SPLASH
        !paired -> TrackerPage.PAIRING
        else -> page
    }

    LaunchedEffect(current) { onDarkScreenChange(current.isDark) }

    BackHandler(enabled = !current.isLocked) {
        adminUnlocked = false
        page = current.parent
    }

    TrackerTheme(dark = current.isDark) {
        when (current) {
            TrackerPage.SPLASH -> SplashScreen(appName = appName, tagline = tagline, version = version)

            TrackerPage.PAIRING -> PairingScreen(
                appName = appName,
                tagline = tagline,
                initialServer = initialServer,
                onPair = onPair,
            )

            TrackerPage.STATUS -> TrackingHomeScreen(
                appName = appName,
                snapshot = snapshot,
                onOpenGate = { page = TrackerPage.GATE },
                modifier = Modifier,
            )

            TrackerPage.GATE -> AdminGateScreen(
                onBack = { page = TrackerPage.STATUS },
                onUnlocked = {
                    adminUnlocked = true
                    page = TrackerPage.ADMIN_SETTINGS
                },
                modifier = Modifier,
            )

            TrackerPage.ADMIN_SETTINGS -> {
                if (!adminUnlocked) {
                    AdminGateScreen(
                        onBack = { page = TrackerPage.STATUS },
                        onUnlocked = {
                            adminUnlocked = true
                            page = TrackerPage.ADMIN_SETTINGS
                        },
                        modifier = Modifier,
                    )
                } else {
                    AdminSettingsScreen(
                        appName = appName,
                        onServerChanged = onServerChanged,
                        onUnpaired = {
                            adminUnlocked = false
                            onUnpaired()
                        },
                        onBack = {
                            adminUnlocked = false
                            page = TrackerPage.STATUS
                        },
                        modifier = Modifier,
                    )
                }
            }
        }
    }
}

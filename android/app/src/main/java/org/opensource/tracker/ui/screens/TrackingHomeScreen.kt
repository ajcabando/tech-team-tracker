package org.opensource.tracker.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.opensource.tracker.ui.ConnectionIndicator
import org.opensource.tracker.ui.IconButtonSurface
import org.opensource.tracker.ui.PulsingStatusDot
import org.opensource.tracker.ui.StatusPill
import org.opensource.tracker.ui.Tone
import org.opensource.tracker.ui.TrackerCard
import org.opensource.tracker.ui.TrackerColors
import org.opensource.tracker.ui.TrackingSnapshot
import org.opensource.tracker.ui.formatAccuracy
import org.opensource.tracker.ui.relativeTimeLabel

/**
 * The technician's only screen.
 *
 * It answers one question: is this phone online. The status is a centered
 * glance card with a large state word so it reads at arm's length, outdoors,
 * wearing gloves. A large settings button opens the administrator password
 * gate; everything behind it — server, pairing, unpair — needs the device
 * admin password. There is no stop button, no tracking switch and no
 * sign-out anywhere on the phone.
 */
@Composable
fun TrackingHomeScreen(
    appName: String,
    snapshot: TrackingSnapshot,
    onOpenGate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val online = snapshot.online
    val tracking = snapshot.active
    val statusColour = when {
        !tracking -> TrackerColors.NightMuted
        !snapshot.hasFix -> TrackerColors.Amber
        else -> TrackerColors.Success
    }
    val statusWord = when {
        !tracking -> "Paused"
        online -> "Online"
        else -> "Offline"
    }
    val subtitle = when {
        !online -> "No connection — points are stored on the phone and upload automatically."
        tracking && snapshot.moving -> "Your location is being recorded."
        tracking -> "Your location is being recorded — currently stopped."
        else -> "Paused — contact your administrator."
    }

    Column(
        modifier
            .fillMaxSize()
            .background(TrackerColors.Night)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // ---------------------------------------------------------------- header
        Text(
            appName,
            style = MaterialTheme.typography.titleLarge,
            color = TrackerColors.NightText,
            textAlign = TextAlign.Center,
            maxLines = 2,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 20.dp),
        )
        Spacer(Modifier.height(14.dp))
        ConnectionIndicator(online)
        Spacer(Modifier.height(18.dp))

        // ------------------------------------------------------------ status card
        TrackerCard(dark = true, padding = 24.dp, modifier = Modifier.widthIn(max = 480.dp)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                PulsingStatusDot(color = statusColour, active = online, size = 20.dp)
                Spacer(Modifier.height(14.dp))
                Text(
                    text = statusWord,
                    style = MaterialTheme.typography.displaySmall,
                    color = statusColour,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TrackerColors.NightBright,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(18.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    StatusPill(
                        text = if (snapshot.hasFix) "GPS ${formatAccuracy(snapshot.accuracyMeters)}" else "No GPS fix",
                        tone = if (snapshot.hasFix) Tone.GOOD else Tone.WARN,
                    )
                    if (snapshot.pendingUploads > 0) {
                        StatusPill(text = "${snapshot.pendingUploads} to upload", tone = Tone.WARN)
                    }
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    if (snapshot.lastUpdateMillis > 0L) {
                        "Last update ${relativeTimeLabel(snapshot.lastUpdateMillis)}"
                    } else {
                        "Waiting for the first GPS fix…"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = TrackerColors.NightBright,
                    textAlign = TextAlign.Center,
                )
            }
        }

        Spacer(Modifier.height(20.dp))
        Text(
            "This phone records its location whenever it is on. Only your administrator can turn tracking off.",
            style = MaterialTheme.typography.bodySmall,
            color = TrackerColors.NightBright,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 480.dp),
        )
        Spacer(Modifier.height(24.dp))
        IconButtonSurface(
            onClick = onOpenGate,
            background = TrackerColors.NightSurface,
        ) { iconModifier, _ ->
            Icon(
                imageVector = Icons.Filled.Settings,
                contentDescription = "Administrator settings",
                tint = TrackerColors.NightText,
                modifier = iconModifier,
            )
        }
        Spacer(Modifier.height(32.dp))
    }
}

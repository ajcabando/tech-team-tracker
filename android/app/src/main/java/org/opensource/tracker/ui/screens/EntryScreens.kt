package org.opensource.tracker.ui.screens

import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import org.opensource.tracker.R
import org.opensource.tracker.ui.ErrorNote
import org.opensource.tracker.ui.IconGlobe
import org.opensource.tracker.ui.IconLock
import org.opensource.tracker.ui.PrimaryActionButton
import org.opensource.tracker.ui.TrackerColors

/**
 * Brand pin. Uses the same artwork as the launcher icon so the app looks like one product
 * from the first frame.
 */
@Composable
fun BrandMark(size: Dp, modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(R.drawable.ic_marker_current),
        contentDescription = null,
        modifier = modifier.size(size),
    )
}

/**
 * Startup screen. Mirrors the reference: brand pin, application name, tagline, a quiet
 * progress indicator and the build version.
 */
@Composable
fun SplashScreen(appName: String, tagline: String, version: String, modifier: Modifier = Modifier) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }
    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(durationMillis = 520),
        label = "splashFade",
    )

    Box(
        modifier
            .fillMaxSize()
            .background(TrackerColors.Night),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .alpha(alpha)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            BrandMark(88.dp)
            Spacer(Modifier.height(18.dp))
            Text(
                appName,
                style = MaterialTheme.typography.headlineMedium,
                color = TrackerColors.NightText,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                tagline,
                style = MaterialTheme.typography.bodyMedium,
                color = TrackerColors.NightMuted,
            )
            Spacer(Modifier.height(34.dp))
            LinearProgressIndicator(
                modifier = Modifier.width(120.dp).height(3.dp).clip(MaterialTheme.shapes.small),
                color = TrackerColors.Primary,
                trackColor = TrackerColors.NightBorder,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "Loading…",
                style = MaterialTheme.typography.labelSmall,
                color = TrackerColors.NightMuted,
            )
        }
        Text(
            "Version $version",
            style = MaterialTheme.typography.labelSmall,
            color = TrackerColors.NightMuted,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 26.dp),
        )
    }
}

/**
 * Device pairing.
 *
 * This app authenticates by pairing, not with an email and password: the administrator
 * generates a single-use code in the dashboard and the phone exchanges it for a device
 * token that can only upload its own GPS points. The screen keeps that flow intact and
 * gives it the reference treatment.
 */
@Composable
fun PairingScreen(
    appName: String,
    tagline: String,
    initialServer: String,
    onPair: (server: String, code: String, onResult: (Result<String>) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    var server by remember { mutableStateOf(initialServer) }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

        Box(
            modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .padding(horizontal = 26.dp, vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Spacer(Modifier.height(24.dp))
                BrandMark(96.dp)
                Spacer(Modifier.height(16.dp))
                Text(appName, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.Center)
                Spacer(Modifier.height(6.dp))
                Text(tagline, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                Spacer(Modifier.height(30.dp))

                OutlinedTextField(
                    value = server,
                    onValueChange = { server = it },
                    label = { Text("Server address") },
                    leadingIcon = { IconGlobe(Modifier.size(24.dp), MaterialTheme.colorScheme.onSurfaceVariant) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.uppercase() },
                    label = { Text("Pairing code") },
                    placeholder = { Text("7K4P-92MX") },
                    leadingIcon = { IconLock(Modifier.size(24.dp), MaterialTheme.colorScheme.onSurfaceVariant) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                        imeAction = ImeAction.Done,
                    ),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth(),
                )

                if (error.isNotBlank()) {
                    Spacer(Modifier.height(12.dp))
                    ErrorNote(error)
                }

                Spacer(Modifier.height(20.dp))
                PrimaryActionButton(
                    text = if (busy) "Pairing…" else "Pair device",
                    enabled = code.isNotBlank() && !busy,
                    onClick = {
                        busy = true
                        error = ""
                        onPair(server, code) { result ->
                            busy = false
                            error = result.exceptionOrNull()?.message.orEmpty()
                        }
                    },
                )

                Spacer(Modifier.height(18.dp))
                Text(
                    "Your administrator generates a single-use code. Tracking starts automatically and is always visible; only your administrator can turn it off.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )

                Spacer(Modifier.height(30.dp))
                Text(
                    stringResource(R.string.brand_footer_title),
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    stringResource(R.string.brand_footer_subtitle),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(16.dp))
            }
        }
}

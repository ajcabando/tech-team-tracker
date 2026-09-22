package org.opensource.tracker.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.opensource.tracker.TrackerApi
import org.opensource.tracker.normalizeServerUrl
import org.opensource.tracker.ui.ErrorNote
import org.opensource.tracker.ui.PrimaryActionButton
import org.opensource.tracker.ui.RowDivider
import org.opensource.tracker.ui.SettingGroup
import org.opensource.tracker.ui.SettingRow
import org.opensource.tracker.ui.TopBar
import org.opensource.tracker.ui.Tone
import org.opensource.tracker.ui.TrackerDialog
import org.opensource.tracker.ui.readDeviceIdentity

/**
 * Locked administrator settings.
 *
 * Reachable only through the admin password gate. From here an administrator can
 * point the phone at a different server (which requires pairing again) or unpair
 * the phone (which stops tracking immediately). Everything is read-only otherwise.
 */
@Composable
fun AdminSettingsScreen(
    appName: String,
    onServerChanged: (server: String) -> Unit,
    onUnpaired: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val identity = remember { runCatching { readDeviceIdentity(context) }.getOrNull() }

    var server by remember { mutableStateOf(identity?.serverUrl ?: "") }
    var serverError by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var confirmUnpair by remember { mutableStateOf(false) }

    fun saveServer() {
        if (busy) return
        val normalized = runCatching { normalizeServerUrl(server) }.getOrElse {
            serverError = it.message ?: "Enter a valid server address"
            return
        }
        serverError = ""
        onServerChanged(normalized)
    }

    fun unpair() {
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            TrackerApi(context).unpairDevice()
                .onSuccess {
                    busy = false
                    onUnpaired()
                }
                .onFailure {
                    busy = false
                    error = it.message ?: "Could not unpair this phone"
                }
        }
    }

    Box(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            TopBar(title = "Admin settings", subtitle = appName, onBack = onBack)

            Column(Modifier.padding(horizontal = 16.dp)) {
                // -------------------------------------------------------- device
                SettingGroup(title = "This device") {
                    SettingRow(title = "Technician", value = identity?.technicianName ?: "—")
                    RowDivider()
                    SettingRow(
                        title = "Device ID",
                        description = "Identifies this phone to the server",
                        value = identity?.deviceId?.take(8)?.uppercase() ?: "—",
                    )
                    RowDivider()
                    SettingRow(title = "Version", value = identity?.appVersion ?: "—")
                }

                Spacer(Modifier.height(20.dp))

                // -------------------------------------------------------- server
                SettingGroup(title = "Server") {
                    SettingRow(
                        title = "Server address",
                        description = "Changing it unpairs this phone — pair again with a new code",
                    )
                    OutlinedTextField(
                        value = server,
                        onValueChange = { server = it; serverError = "" },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                    if (serverError.isNotBlank()) ErrorNote(serverError, Modifier.padding(horizontal = 16.dp))
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
                        PrimaryActionButton(text = "Save server", onClick = ::saveServer)
                    }
                }

                Spacer(Modifier.height(20.dp))

                // -------------------------------------------------------- danger
                SettingGroup(title = "Deactivate") {
                    SettingRow(
                        title = "Unpair this phone",
                        description = "Stops tracking immediately. GPS history is kept on the server.",
                        tone = Tone.BAD,
                        onClick = { confirmUnpair = true },
                    )
                }

                if (error.isNotBlank()) {
                    Spacer(Modifier.height(12.dp))
                    ErrorNote(error)
                }
                Spacer(Modifier.height(32.dp))
            }
        }

        if (confirmUnpair) {
            TrackerDialog(
                title = "Unpair this phone?",
                message = "Tracking stops immediately and this phone is detached. Pair again with a new code from your administrator to resume. Recorded trips and history are not affected.",
                confirmLabel = "Unpair",
                destructive = true,
                onConfirm = {
                    confirmUnpair = false
                    unpair()
                },
                onDismiss = { confirmUnpair = false },
            )
        }
    }
}

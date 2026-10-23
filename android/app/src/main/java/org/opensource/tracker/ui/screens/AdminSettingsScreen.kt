package org.opensource.tracker.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.opensource.tracker.AdminVerificationRequiredException
import org.opensource.tracker.ApkUpdater
import org.opensource.tracker.ReleaseInfo
import org.opensource.tracker.TrackerApi
import org.opensource.tracker.normalizeServerUrl
import org.opensource.tracker.ui.ErrorNote
import org.opensource.tracker.ui.GhostActionButton
import org.opensource.tracker.ui.PrimaryActionButton
import org.opensource.tracker.ui.RowDivider
import org.opensource.tracker.ui.SettingGroup
import org.opensource.tracker.ui.SettingRow
import org.opensource.tracker.ui.TopBar
import org.opensource.tracker.ui.Tone
import org.opensource.tracker.ui.TrackerCard
import org.opensource.tracker.ui.TrackerDialog
import org.opensource.tracker.ui.readDeviceIdentity

/** What the server says about the build currently published at /tracker.apk. */
private sealed interface UpdateState {
    object Checking : UpdateState
    object UpToDate : UpdateState
    data class Available(val release: ReleaseInfo) : UpdateState
    data class Failed(val message: String) : UpdateState
}

/**
 * Locked administrator settings.
 *
 * Reachable only through the admin password gate. From here an administrator can
 * point the phone at a different server (which requires pairing again), update the
 * app, or unpair the phone (which stops tracking immediately). Everything is
 * read-only otherwise.
 *
 * The updater lives here on purpose: a technician can see the settings icon but not
 * past the password gate, and the install itself is authorized by the server once
 * that password has been verified.
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

    var updateState by remember { mutableStateOf<UpdateState>(UpdateState.Checking) }
    var updateError by remember { mutableStateOf("") }
    var downloadProgress by remember { mutableStateOf<Float?>(null) }
    var installBusy by remember { mutableStateOf(false) }
    var installerOpen by remember { mutableStateOf(false) }
    var confirmInstall by remember { mutableStateOf<ReleaseInfo?>(null) }
    var passwordPrompt by remember { mutableStateOf(false) }
    var pendingRelease by remember { mutableStateOf<ReleaseInfo?>(null) }
    var verifyBusy by remember { mutableStateOf(false) }
    var passwordError by remember { mutableStateOf("") }

    suspend fun checkForUpdate() {
        updateState = UpdateState.Checking
        TrackerApi(context).latestRelease()
            .onSuccess { release ->
                updateState = if (release != null && ApkUpdater.updateAvailable(release)) {
                    UpdateState.Available(release)
                } else {
                    UpdateState.UpToDate
                }
            }
            .onFailure { updateState = UpdateState.Failed(it.message ?: "Could not check for updates") }
    }

    suspend fun downloadAndInstall(release: ReleaseInfo) {
        if (!ApkUpdater.canInstall(context)) {
            installBusy = false
            updateError = "Allow \"Install unknown apps\" for this app, then tap install again."
            ApkUpdater.openInstallPermissionSettings(context)
            return
        }
        updateError = ""
        downloadProgress = 0f
        ApkUpdater.download(context, release) { progress -> downloadProgress = progress }
            .onSuccess { file ->
                downloadProgress = null
                installBusy = false
                ApkUpdater.install(context, file)
                    .onSuccess { installerOpen = true }
                    .onFailure { updateError = it.message ?: "Could not open the installer" }
            }
            .onFailure {
                downloadProgress = null
                installBusy = false
                updateError = it.message ?: "Could not download the update"
            }
    }

    /** Ask the server to authorize the install, prompting for the password if the window lapsed. */
    suspend fun beginInstall(release: ReleaseInfo) {
        if (installBusy) return
        installBusy = true
        updateError = ""
        installerOpen = false
        val result = TrackerApi(context).authorizeUpdate(release.versionCode)
        if (result.exceptionOrNull() is AdminVerificationRequiredException) {
            installBusy = false
            pendingRelease = release
            passwordError = ""
            passwordPrompt = true
            return
        }
        val authorized = result.getOrElse {
            installBusy = false
            updateError = it.message ?: "Could not authorize the update"
            return
        }
        downloadAndInstall(authorized)
    }

    fun submitPassword(password: String) {
        val release = pendingRelease ?: return
        if (password.isBlank() || verifyBusy) return
        verifyBusy = true
        passwordError = ""
        scope.launch {
            TrackerApi(context).verifyAdmin(password)
                .onSuccess {
                    verifyBusy = false
                    // The dialog may have been dismissed while this request was in
                    // flight; a dismissed prompt must never start an install.
                    if (!passwordPrompt) return@onSuccess
                    passwordPrompt = false
                    pendingRelease = null
                    scope.launch { beginInstall(release) }
                }
                .onFailure {
                    verifyBusy = false
                    passwordError = it.message ?: "Incorrect password"
                }
        }
    }

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

    LaunchedEffect(Unit) { checkForUpdate() }

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

                // -------------------------------------------------------- update
                SettingGroup(title = "Software update") {
                    val state = updateState
                    SettingRow(
                        title = "Update",
                        description = "Installed in place. Your pairing and any queued GPS points are kept.",
                        value = when (state) {
                            UpdateState.Checking -> "Checking…"
                            UpdateState.UpToDate -> "Latest version"
                            is UpdateState.Available -> "v${state.release.versionName} available"
                            is UpdateState.Failed -> "Check failed"
                        },
                    )
                    when (state) {
                        UpdateState.Checking -> Unit
                        UpdateState.UpToDate -> Unit
                        is UpdateState.Available -> {
                            RowDivider()
                            SettingRow(
                                title = "Available",
                                description = "Installing requires the administrator password.",
                                value = "v${state.release.versionName}",
                            )
                            if (installerOpen) {
                                Text(
                                    "Android's installer is open. Confirm the update there; tracking restarts when it finishes. If it was cancelled, the downloaded file is kept and you can try again.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp),
                                )
                            }
                            Box(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
                                PrimaryActionButton(
                                    text = when {
                                        downloadProgress != null -> "Downloading ${(((downloadProgress ?: 0f) * 100).toInt())}%"
                                        installBusy -> "Preparing…"
                                        else -> "Download and install"
                                    },
                                    enabled = !installBusy,
                                    onClick = { confirmInstall = state.release },
                                )
                            }
                        }
                        is UpdateState.Failed -> {
                            RowDivider()
                            Box(Modifier.padding(16.dp)) { ErrorNote(state.message) }
                            Box(Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp)) {
                                GhostActionButton("Try again", onClick = { scope.launch { checkForUpdate() } })
                            }
                        }
                    }
                    if (updateError.isNotBlank()) {
                        RowDivider()
                        Box(Modifier.padding(16.dp)) { ErrorNote(updateError) }
                    }
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

        confirmInstall?.let { release ->
            TrackerDialog(
                title = "Install ${release.versionName}?",
                message = "Android's installer will open. Tracking restarts automatically when the install finishes, and your pairing and queued GPS points are kept.",
                confirmLabel = "Install",
                onConfirm = {
                    confirmInstall = null
                    scope.launch { beginInstall(release) }
                },
                onDismiss = { confirmInstall = null },
            )
        }

        if (passwordPrompt) {
            AdminPasswordDialog(
                busy = verifyBusy,
                error = passwordError,
                onDismiss = {
                    passwordPrompt = false
                    pendingRelease = null
                    passwordError = ""
                    verifyBusy = false
                },
                onSubmit = ::submitPassword,
            )
        }
    }
}

/**
 * The same password-only gate as [AdminGateScreen], inline, for the case where the
 * five-minute admin window lapsed between unlocking settings and tapping install.
 * The password is verified by the server; nothing is stored on the phone.
 */
@Composable
private fun AdminPasswordDialog(
    busy: Boolean,
    error: String,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var password by remember { mutableStateOf("") }

    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable(onClick = onDismiss),
        contentAlignment = Alignment.Center,
    ) {
        TrackerCard(Modifier.padding(28.dp), padding = 20.dp) {
            Text(
                "Administrator approval",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Enter the device admin password issued with the pairing code to install this update.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Admin password") },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (password.isNotBlank() && !busy) onSubmit(password) }),
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth(),
            )
            if (error.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                ErrorNote(error)
            }
            Spacer(Modifier.height(18.dp))
            PrimaryActionButton(
                text = if (busy) "Verifying…" else "Verify and install",
                enabled = password.isNotBlank() && !busy,
                onClick = { onSubmit(password) },
            )
            Spacer(Modifier.height(10.dp))
            GhostActionButton("Cancel", onDismiss)
        }
    }
}

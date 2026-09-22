package org.opensource.tracker.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.opensource.tracker.TrackerApi
import org.opensource.tracker.ui.ErrorNote
import org.opensource.tracker.ui.PrimaryActionButton
import org.opensource.tracker.ui.TopBar

/**
 * Password-only administrator gate.
 *
 * There is deliberately no username: the password is the device admin secret the
 * administrator received with the pairing code. It is verified against the server,
 * never on the phone, and a success unlocks the admin settings for a few minutes.
 */
@Composable
fun AdminGateScreen(
    onBack: () -> Unit,
    onUnlocked: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun verify() {
        if (password.isBlank() || busy) return
        busy = true
        error = ""
        scope.launch {
            TrackerApi(context).verifyAdmin(password)
                .onSuccess {
                    busy = false
                    password = ""
                    onUnlocked()
                }
                .onFailure {
                    busy = false
                    error = it.message ?: "Incorrect password"
                }
        }
    }

    Column(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        TopBar(
            title = "Admin settings",
            subtitle = "Device administrator only",
            onBack = onBack,
        )
        Column(
            Modifier.padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Enter the device admin password issued with the pairing code. Technicians cannot change anything on this phone without it.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(18.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; error = "" },
                label = { Text("Admin password") },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { verify() }),
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth(),
            )
            if (error.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                ErrorNote(error)
            }
            Spacer(Modifier.height(20.dp))
            PrimaryActionButton(
                text = if (busy) "Verifying…" else "Unlock settings",
                enabled = password.isNotBlank() && !busy,
                onClick = ::verify,
            )
            Spacer(Modifier.height(32.dp))
        }
    }
}

package org.opensource.tracker.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.foundation.Canvas
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Status tone shared by pills, tiles and indicators. */
enum class Tone { GOOD, WARN, BAD, INFO, NEUTRAL }

@Composable
fun Tone.color(): Color = when (this) {
    Tone.GOOD -> TrackerColors.Success
    Tone.WARN -> TrackerColors.Amber
    Tone.BAD -> TrackerColors.Danger
    Tone.INFO -> TrackerColors.Primary
    Tone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
fun Tone.softColor(): Color = when (this) {
    Tone.GOOD -> TrackerColors.SuccessSoft
    Tone.WARN -> TrackerColors.AmberSoft
    Tone.BAD -> TrackerColors.DangerSoft
    Tone.INFO -> TrackerColors.PrimarySoft
    Tone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant
}

/**
 * Card surface. [dark] selects the field-shell styling (used on the tracking dashboard);
 * everything else uses the light workspace styling.
 */
@Composable
fun TrackerCard(
    modifier: Modifier = Modifier,
    dark: Boolean = false,
    padding: Dp = 16.dp,
    content: @Composable () -> Unit,
) {
    val background = if (dark) TrackerColors.NightCard else MaterialTheme.colorScheme.surface
    val border = if (dark) TrackerColors.NightBorder else MaterialTheme.colorScheme.outline
    Column(
        modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .background(background)
            .border(1.dp, border, MaterialTheme.shapes.medium)
            .padding(padding),
        content = { content() },
    )
}

/** Small, wide, upper-case label used to head a group of rows or a card. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, dark: Boolean = false) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = if (dark) TrackerColors.NightMuted else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/** Rounded status chip: green when active, amber when delayed, red when offline. Large enough to read outdoors. */
@Composable
fun StatusPill(text: String, tone: Tone, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(CircleShape)
            .background(tone.softColor())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(tone.color()))
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = tone.color(),
        )
    }
}

/**
 * Metric tile: small icon, small label, large value. Used for speed, accuracy, battery
 * and every trip statistic.
 */
@Composable
fun MetricTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    icon: (@Composable (Modifier, Color) -> Unit)? = null,
    dark: Boolean = false,
    tone: Tone? = null,
    hint: String? = null,
) {
    val background = if (dark) TrackerColors.NightSurface else MaterialTheme.colorScheme.surface
    val border = if (dark) TrackerColors.NightBorder else MaterialTheme.colorScheme.outline
    val labelColor = if (dark) TrackerColors.NightMuted else MaterialTheme.colorScheme.onSurfaceVariant
    val valueColor = when {
        tone != null -> tone.color()
        dark -> TrackerColors.NightText
        else -> MaterialTheme.colorScheme.onSurface
    }
    Column(
        modifier
            .clip(MaterialTheme.shapes.small)
            .background(background)
            .border(1.dp, border, MaterialTheme.shapes.small)
            .padding(horizontal = 14.dp, vertical = 13.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (icon != null) icon(Modifier.size(15.dp), labelColor)
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = labelColor)
        }
        Spacer(Modifier.height(8.dp))
        Text(value, style = MaterialTheme.typography.headlineSmall, color = valueColor, maxLines = 1)
        if (hint != null) {
            Spacer(Modifier.height(3.dp))
            Text(hint, style = MaterialTheme.typography.bodySmall, color = labelColor, maxLines = 1)
        }
    }
}

/** Filled blue action button (start tracking, play route, sign in). */
@Composable
fun PrimaryActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: (@Composable (Modifier, Color) -> Unit)? = null,
) {
    Surface(
        color = if (enabled) TrackerColors.Primary else TrackerColors.Primary.copy(alpha = 0.4f),
        shape = MaterialTheme.shapes.small,
        modifier = modifier.fillMaxWidth().height(64.dp).clip(MaterialTheme.shapes.small).clickable(enabled = enabled, onClick = onClick),
    ) {
        Row(
            Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                icon(Modifier.size(22.dp), Color.White)
                Spacer(Modifier.width(10.dp))
            }
            Text(text, style = MaterialTheme.typography.titleLarge, color = Color.White)
        }
    }
}

/** Destructive action button. Red is reserved for stopping tracking and erasing data. */
@Composable
fun DangerActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val container by animateColorAsState(
        targetValue = if (enabled) TrackerColors.Danger else TrackerColors.Danger.copy(alpha = 0.4f),
        label = "dangerButton",
    )
    Surface(
        color = container,
        shape = MaterialTheme.shapes.small,
        modifier = modifier.fillMaxWidth().height(64.dp).clip(MaterialTheme.shapes.small).clickable(enabled = enabled, onClick = onClick),
    ) {
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(16.dp).background(Color.White, RoundedCornerShape(3.dp)))
            Spacer(Modifier.width(10.dp))
            Text(text, style = MaterialTheme.typography.titleLarge, color = Color.White)
        }
    }
}

/** Low-emphasis outlined button. */
@Composable
fun GhostActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: (@Composable (Modifier, Color) -> Unit)? = null,
) {
    val tint = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(
        color = Color.Transparent,
        shape = MaterialTheme.shapes.small,
        modifier = modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(MaterialTheme.shapes.small)
            .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small)
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                icon(Modifier.size(22.dp), tint)
                Spacer(Modifier.width(10.dp))
            }
            Text(text, style = MaterialTheme.typography.titleLarge, color = tint)
        }
    }
}

/**
 * Light workspace header. Screens pushed on top of a section show a back arrow; section
 * roots show the title only.
 */
@Composable
fun TopBar(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.size(28.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (trailing != null) trailing()
    }
}

/** Filled home glyph (kept for future use; the technician phone has no bottom bar). */
@Composable
fun IconHome(modifier: Modifier = Modifier.size(22.dp), tint: Color = TrackerColors.Primary) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val path = Path().apply {
            moveTo(w * 0.5f, h * 0.14f)
            lineTo(w * 0.9f, h * 0.48f)
            lineTo(w * 0.9f, h * 0.88f)
            lineTo(w * 0.6f, h * 0.88f)
            lineTo(w * 0.6f, h * 0.62f)
            lineTo(w * 0.4f, h * 0.62f)
            lineTo(w * 0.4f, h * 0.88f)
            lineTo(w * 0.1f, h * 0.88f)
            lineTo(w * 0.1f, h * 0.48f)
            close()
        }
        drawPath(path, tint)
    }
}

/** Grid glyph for the More section. */
@Composable
fun IconGrid(modifier: Modifier = Modifier.size(22.dp), tint: Color = TrackerColors.Primary) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val cell = w * 0.36f
        val gap = w * 0.12f
        listOf(0f, 1f).forEach { row ->
            listOf(0f, 1f).forEach { column ->
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(
                        w * 0.08f + column * (cell + gap),
                        h * 0.08f + row * (cell + gap),
                    ),
                    size = Size(cell, cell),
                    cornerRadius = CornerRadius(w * 0.08f),
                )
            }
        }
    }
}

/** Grouped settings block. */
@Composable
fun SettingGroup(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth()) {
        SectionLabel(title, Modifier.padding(start = 4.dp, bottom = 8.dp))
        TrackerCard(padding = 0.dp) {
            Column(Modifier.fillMaxWidth()) { content() }
        }
    }
}

/** A read-only or navigable settings row. */
@Composable
fun SettingRow(
    title: String,
    modifier: Modifier = Modifier,
    value: String? = null,
    description: String? = null,
    icon: (@Composable (Modifier, Color) -> Unit)? = null,
    tone: Tone? = null,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val tint = tone?.color() ?: MaterialTheme.colorScheme.onSurface
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) icon(Modifier.size(22.dp), if (tone != null) tint else MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = tint)
            if (description != null) {
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        when {
            trailing != null -> trailing()
            value != null -> Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            onClick != null -> IconChevron(Modifier.size(22.dp), MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A settings row with a switch. The whole row is tappable, not just the control. */
@Composable
fun SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
    enabled: Boolean = true,
    icon: (@Composable (Modifier, Color) -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clickable(enabled = enabled) { onCheckedChange(!checked) }
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) icon(Modifier.size(19.dp), MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            if (description != null) {
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

/** Divider matching the card border colour. */
@Composable
fun RowDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outline))
}

/** Shimmering placeholder used while real data loads. */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, corner: Dp = 10.dp) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val animated by transition.animateFloat(
        initialValue = 0.10f,
        targetValue = 0.24f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 950, easing = LinearEasing), RepeatMode.Reverse),
        label = "skeletonAlpha",
    )
    Box(modifier.clip(RoundedCornerShape(corner)).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = animated)))
}

/** Skeleton stand-in for a list of trip cards. */
@Composable
fun SkeletonList(rows: Int = 4, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(rows) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.medium)
                    .background(MaterialTheme.colorScheme.surface)
                    .border(1.dp, MaterialTheme.colorScheme.outline, MaterialTheme.shapes.medium)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SkeletonBlock(Modifier.width(78.dp).height(10.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.62f).height(13.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.42f).height(11.dp))
            }
        }
    }
}

/** Empty state with an optional recovery action. */
@Composable
fun EmptyStateView(
    title: String,
    detail: String,
    modifier: Modifier = Modifier,
    icon: (@Composable (Modifier, Color) -> Unit)? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (icon != null) {
            Box(
                Modifier.size(56.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                icon(Modifier.size(26.dp), MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.Center)
        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(6.dp))
            GhostActionButton(actionLabel, onAction, Modifier.width(190.dp))
        }
    }
}

/** Inline error notice. Never blank, so a failed request always explains itself. */
@Composable
fun ErrorNote(message: String, modifier: Modifier = Modifier) {
    if (message.isBlank()) return
    Row(
        modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.small)
            .background(TrackerColors.DangerSoft)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = "!",
            style = MaterialTheme.typography.titleLarge,
            color = TrackerColors.Danger,
        )
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = TrackerColors.Danger,
        )
    }
}

/**
 * Confirmation sheet used for irreversible actions. [confirmLabel] is only offered after
 * the caller has explained the consequence, so destructive taps are always deliberate.
 */
@Composable
fun TrackerDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    destructive: Boolean = false,
) {
    Box(
        modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable(onClick = onDismiss),
        contentAlignment = Alignment.Center,
    ) {
        TrackerCard(Modifier.padding(28.dp), padding = 20.dp) {
            Text(title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(8.dp))
            Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(18.dp))
            if (destructive) {
                DangerActionButton(confirmLabel, onConfirm)
            } else {
                PrimaryActionButton(confirmLabel, onConfirm)
            }
            Spacer(Modifier.height(10.dp))
            GhostActionButton("Cancel", onDismiss)
        }
    }
}

/**
 * Tracking indicator: a solid dot with a soft halo that pulses while tracking is active.
 * The pulse is a single infinite transition so it costs nothing measurable.
 */
@Composable
fun PulsingStatusDot(color: Color, active: Boolean, size: Dp = 14.dp, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "pulse")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 1700, easing = LinearEasing), RepeatMode.Restart),
        label = "pulseProgress",
    )
    val fraction = if (active) progress else 0f
    Box(modifier.size(size * 2.6f), contentAlignment = Alignment.Center) {
        if (active) {
            Box(
                Modifier
                    .size(size * (1f + fraction * 1.6f))
                    .alpha((1f - fraction).coerceIn(0f, 1f) * 0.45f)
                    .clip(CircleShape)
                    .background(color),
            )
        }
        Box(Modifier.size(size).clip(CircleShape).background(color))
    }
}

/** Small connection indicator for the header, animated between states. */
@Composable
fun ConnectionIndicator(online: Boolean, modifier: Modifier = Modifier) {
    val color by animateColorAsState(
        targetValue = if (online) TrackerColors.Success else TrackerColors.NightMuted,
        label = "connection",
    )
    Row(
        modifier
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.06f))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Text(
            if (online) "Online" else "Offline",
            style = MaterialTheme.typography.bodySmall,
            color = TrackerColors.NightMuted,
        )
    }
}

/** Circular icon button used in headers and as a map overlay control. Glove-sized. */
@Composable
fun IconButtonSurface(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    background: Color = Color.White,
    content: @Composable (Modifier, Color) -> Unit,
) {
    Box(
        modifier
            .size(56.dp)
            .clip(CircleShape)
            .background(background)
            .border(1.dp, TrackerColors.NightBorder, CircleShape)
            .clickable(onClick = onClick)
            .padding(14.dp),
        contentAlignment = Alignment.Center,
    ) {
        content(Modifier.fillMaxSize(), MaterialTheme.colorScheme.onSurface)
    }
}

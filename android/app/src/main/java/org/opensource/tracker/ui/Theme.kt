package org.opensource.tracker.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Tech Team Tracker design tokens.
 *
 * The product uses two surfaces, exactly as in the reference design:
 *
 *  - the **dark field shell** (splash and the tracking dashboard), where the technician
 *    checks status at a glance, often outdoors in bright light;
 *  - the **light workspace** (maps, trips, details, settings, notifications), where the
 *    technician reads lists and navigates.
 *
 * Every screen pulls its colours from here, so the two surfaces stay consistent and a
 * rebrand is a single-file change.
 */
object TrackerColors {
    // Dark field shell
    val Night = Color(0xFF070D14)
    val NightSurface = Color(0xFF101B26)
    val NightCard = Color(0xFF16232F)
    val NightBorder = Color(0xFF243544)
    val NightText = Color(0xFFF8FAFC)
    val NightMuted = Color(0xFF93A6B5)
    // High-contrast secondary text for outdoor legibility on the status screen.
    val NightBright = Color(0xFFCBD5E1)

    // Light workspace
    val Day = Color(0xFFF5F7FA)
    val DayCard = Color(0xFFFFFFFF)
    val DayBorder = Color(0xFFE6EAF0)
    val Ink = Color(0xFF0F172A)
    val InkMuted = Color(0xFF64748B)

    // Brand and status
    val Primary = Color(0xFF2F80ED)
    val PrimarySoft = Color(0x1A2F80ED)
    val Success = Color(0xFF22C55E)
    val SuccessSoft = Color(0x1F22C55E)
    val Amber = Color(0xFFF59E0B)
    val AmberSoft = Color(0x1FF59E0B)
    val Danger = Color(0xFFEF4444)
    val DangerSoft = Color(0x1FEF4444)
}

private val LightScheme = lightColorScheme(
    primary = TrackerColors.Primary,
    onPrimary = Color.White,
    secondary = TrackerColors.Success,
    onSecondary = Color.White,
    background = TrackerColors.Day,
    onBackground = TrackerColors.Ink,
    surface = TrackerColors.DayCard,
    onSurface = TrackerColors.Ink,
    surfaceVariant = Color(0xFFEFF3F8),
    onSurfaceVariant = TrackerColors.InkMuted,
    outline = TrackerColors.DayBorder,
    error = TrackerColors.Danger,
    onError = Color.White,
)

private val DarkScheme = darkColorScheme(
    primary = TrackerColors.Primary,
    onPrimary = Color.White,
    secondary = TrackerColors.Success,
    onSecondary = Color.White,
    background = TrackerColors.Night,
    onBackground = TrackerColors.NightText,
    surface = TrackerColors.NightSurface,
    onSurface = TrackerColors.NightText,
    surfaceVariant = TrackerColors.NightCard,
    onSurfaceVariant = TrackerColors.NightMuted,
    outline = TrackerColors.NightBorder,
    error = TrackerColors.Danger,
    onError = Color.White,
)

/**
 * Typography tuned for a technician glancing at the phone, often outdoors wearing
 * gloves: body text is large, labels never drop below 13sp, and the tracking state
 * word uses display sizes so it reads at arm's length.
 */
private val TrackerTypography = Typography(
    displaySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 40.sp, lineHeight = 44.sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 36.sp),
    headlineSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 31.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, lineHeight = 25.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 17.sp, lineHeight = 24.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 21.sp),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 17.sp,
        letterSpacing = 1.1.sp,
    ),
)

private val TrackerShapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
)

/**
 * Wraps content in the design system. Dark screens (splash, tracking dashboard) pass
 * `dark = true`; everything else uses the light workspace scheme.
 */
@Composable
fun TrackerTheme(dark: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (dark) DarkScheme else LightScheme,
        typography = TrackerTypography,
        shapes = TrackerShapes,
        content = content,
    )
}

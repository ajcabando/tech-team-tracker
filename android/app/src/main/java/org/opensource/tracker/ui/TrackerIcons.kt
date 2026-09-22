package org.opensource.tracker.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * Outline icon set for Tech Team Tracker.
 *
 * The icons are drawn with [Canvas] rather than pulled from the Material icon library:
 * the extended icon set is several megabytes of assets, and this keeps the APK small
 * while giving the interface its own consistent line weight and rounded caps.
 */

@Composable
private fun Glyph(modifier: Modifier, tint: Color, draw: DrawScope.(Float) -> Unit) {
    Canvas(modifier) { draw(2.2.dp.toPx()) }
}

private fun DrawScope.outline(width: Float) = Stroke(width = width, cap = StrokeCap.Round, join = StrokeJoin.Round)

/** Folded map, for the map section. */
@Composable
fun IconMap(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val pen = outline(stroke)
        drawRoundRect(
            color = tint,
            topLeft = Offset(w * 0.08f, h * 0.14f),
            size = Size(w * 0.84f, h * 0.72f),
            cornerRadius = CornerRadius(w * 0.12f),
            style = pen,
        )
        drawLine(tint, Offset(w * 0.37f, h * 0.14f), Offset(w * 0.37f, h * 0.86f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.63f, h * 0.14f), Offset(w * 0.63f, h * 0.86f), stroke, StrokeCap.Round)
    }
}

/** Trip list, for the trips section and trip rows. */
@Composable
fun IconTripList(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val rows = listOf(0.28f, 0.52f, 0.76f)
        rows.forEach { y ->
            drawCircle(tint, radius = stroke * 0.7f, center = Offset(w * 0.2f, h * y))
            drawLine(tint, Offset(w * 0.42f, h * y), Offset(w * 0.88f, h * y), stroke, StrokeCap.Round)
        }
    }
}

/** Pause glyph for route playback. */
@Composable
fun IconPause(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val bar = stroke * 1.6f
        drawLine(tint, Offset(w * 0.34f, h * 0.2f), Offset(w * 0.34f, h * 0.8f), bar, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.66f, h * 0.2f), Offset(w * 0.66f, h * 0.8f), bar, StrokeCap.Round)
    }
}

/** Restart glyph (circular arrow) for route playback. */
@Composable
fun IconRestart(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val pen = outline(stroke)
        val inset = stroke * 1.4f
        drawArc(
            color = tint,
            startAngle = -60f,
            sweepAngle = 290f,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = Size(size.width - inset * 2, size.height - inset * 2),
            style = pen,
        )
        val head = Path().apply {
            moveTo(size.width * 0.62f, size.height * 0.06f)
            lineTo(size.width * 0.62f, size.height * 0.36f)
            lineTo(size.width * 0.34f, size.height * 0.21f)
            close()
        }
        drawPath(head, tint)
    }
}

/** Speedometer, for the current-speed tile. */
@Composable
fun IconSpeed(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val pen = outline(stroke)
        val inset = stroke * 1.3f
        drawArc(
            color = tint,
            startAngle = 155f,
            sweepAngle = 230f,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = Size(size.width - inset * 2, size.height - inset * 2),
            style = pen,
        )
        drawLine(
            tint,
            Offset(size.width * 0.5f, size.height * 0.72f),
            Offset(size.width * 0.72f, size.height * 0.36f),
            stroke,
            StrokeCap.Round,
        )
    }
}

/** Battery outline with a fill bar when the level is known. */
@Composable
fun IconBattery(level: Int?, modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val bodyTop = h * 0.22f
        val bodyHeight = h * 0.56f
        drawRoundRect(
            color = tint,
            topLeft = Offset(w * 0.06f, bodyTop),
            size = Size(w * 0.78f, bodyHeight),
            cornerRadius = CornerRadius(w * 0.1f),
            style = outline(stroke),
        )
        drawRoundRect(
            color = tint,
            topLeft = Offset(w * 0.87f, h * 0.4f),
            size = Size(w * 0.09f, h * 0.2f),
            cornerRadius = CornerRadius(w * 0.04f),
        )
        if (level != null) {
            val fraction = (level.coerceIn(0, 100) / 100f).coerceAtLeast(0.06f)
            val inner = w * 0.6f * fraction
            val fillColor = when {
                level <= 20 -> TrackerColors.Danger
                level <= 40 -> TrackerColors.Amber
                else -> TrackerColors.Success
            }
            drawRoundRect(
                color = fillColor,
                topLeft = Offset(w * 0.15f, bodyTop + bodyHeight * 0.22f),
                size = Size(inner, bodyHeight * 0.56f),
                cornerRadius = CornerRadius(w * 0.06f),
            )
        }
    }
}

/** Crosshair, for GPS accuracy and "centre on me". */
@Composable
fun IconTarget(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val centre = Offset(w * 0.5f, h * 0.5f)
        val radius = minOf(w, h) * 0.3f
        drawCircle(tint, radius = radius, center = centre, style = outline(stroke))
        drawCircle(tint, radius = stroke * 1.1f, center = centre)
        drawLine(tint, Offset(w * 0.5f, h * 0.04f), Offset(w * 0.5f, h * 0.2f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.5f, h * 0.8f), Offset(w * 0.5f, h * 0.96f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.04f, h * 0.5f), Offset(w * 0.2f, h * 0.5f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.8f, h * 0.5f), Offset(w * 0.96f, h * 0.5f), stroke, StrokeCap.Round)
    }
}

/** Stacked layers, for the map tile control. */
@Composable
fun IconLayers(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val pen = outline(stroke)
        val top = Path().apply {
            moveTo(w * 0.5f, h * 0.14f)
            lineTo(w * 0.92f, h * 0.38f)
            lineTo(w * 0.5f, h * 0.62f)
            lineTo(w * 0.08f, h * 0.38f)
            close()
        }
        drawPath(top, tint, style = pen)
        drawLine(tint, Offset(w * 0.08f, h * 0.6f), Offset(w * 0.5f, h * 0.84f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.5f, h * 0.84f), Offset(w * 0.92f, h * 0.6f), stroke, StrokeCap.Round)
    }
}

/** Plus / minus, for the map zoom controls. */
@Composable
fun IconPlus(modifier: Modifier = Modifier.size(20.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        drawLine(tint, Offset(w * 0.2f, h * 0.5f), Offset(w * 0.8f, h * 0.5f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.5f, h * 0.2f), Offset(w * 0.5f, h * 0.8f), stroke, StrokeCap.Round)
    }
}

@Composable
fun IconMinus(modifier: Modifier = Modifier.size(20.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        drawLine(tint, Offset(w * 0.2f, h * 0.5f), Offset(w * 0.8f, h * 0.5f), stroke, StrokeCap.Round)
    }
}

/** Clock, for the last-update tile. */
@Composable
fun IconClock(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val centre = Offset(w * 0.5f, h * 0.5f)
        drawCircle(tint, radius = minOf(w, h) * 0.42f, center = centre, style = outline(stroke))
        drawLine(tint, centre, Offset(w * 0.5f, h * 0.28f), stroke, StrokeCap.Round)
        drawLine(tint, centre, Offset(w * 0.68f, h * 0.58f), stroke, StrokeCap.Round)
    }
}

/** Upload arrow, for the offline queue (points waiting to reach the server). */
@Composable
fun IconUpload(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        drawLine(tint, Offset(w * 0.5f, h * 0.74f), Offset(w * 0.5f, h * 0.16f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.28f, h * 0.38f), Offset(w * 0.5f, h * 0.16f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.72f, h * 0.38f), Offset(w * 0.5f, h * 0.16f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.22f, h * 0.86f), Offset(w * 0.78f, h * 0.86f), stroke, StrokeCap.Round)
    }
}

/** Globe, for the server address field. */
@Composable
fun IconGlobe(modifier: Modifier = Modifier.size(20.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val pen = outline(stroke)
        val centre = Offset(w * 0.5f, h * 0.5f)
        drawCircle(tint, radius = minOf(w, h) * 0.42f, center = centre, style = pen)
        drawLine(tint, Offset(w * 0.08f, h * 0.5f), Offset(w * 0.92f, h * 0.5f), stroke, StrokeCap.Round)
        drawArc(
            color = tint,
            startAngle = 90f,
            sweepAngle = 180f,
            useCenter = false,
            topLeft = Offset(w * 0.26f, h * 0.08f),
            size = Size(w * 0.48f, h * 0.84f),
            style = pen,
        )
        drawArc(
            color = tint,
            startAngle = 270f,
            sweepAngle = 180f,
            useCenter = false,
            topLeft = Offset(w * 0.26f, h * 0.08f),
            size = Size(w * 0.48f, h * 0.84f),
            style = pen,
        )
    }
}

/** Sign-out glyph (open door with an arrow), used for the destructive Logout row. */
@Composable
fun IconLogout(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val pen = outline(stroke)
        drawPath(
            Path().apply {
                moveTo(w * 0.56f, h * 0.12f)
                lineTo(w * 0.12f, h * 0.12f)
                lineTo(w * 0.12f, h * 0.88f)
                lineTo(w * 0.56f, h * 0.88f)
            },
            tint,
            style = pen,
        )
        drawLine(tint, Offset(w * 0.46f, h * 0.5f), Offset(w * 0.9f, h * 0.5f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.72f, h * 0.3f), Offset(w * 0.92f, h * 0.5f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.72f, h * 0.7f), Offset(w * 0.92f, h * 0.5f), stroke, StrokeCap.Round)
    }
}

/** Bell, for the notifications entry in More and Settings. */
@Composable
fun IconBell(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val pen = outline(stroke)
        drawPath(
            Path().apply {
                moveTo(w * 0.24f, h * 0.68f)
                lineTo(w * 0.24f, h * 0.44f)
                cubicTo(w * 0.24f, h * 0.18f, w * 0.76f, h * 0.18f, w * 0.76f, h * 0.44f)
                lineTo(w * 0.76f, h * 0.68f)
                lineTo(w * 0.86f, h * 0.78f)
                lineTo(w * 0.14f, h * 0.78f)
                close()
            },
            tint,
            style = pen,
        )
        drawArc(
            color = tint,
            startAngle = 0f,
            sweepAngle = 180f,
            useCenter = false,
            topLeft = Offset(w * 0.36f, h * 0.74f),
            size = Size(w * 0.28f, h * 0.2f),
            style = pen,
        )
    }
}

/** Hands-free / shield glyph used by the privacy card. */
@Composable
fun IconShield(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val pen = outline(stroke)
        drawPath(
            Path().apply {
                moveTo(w * 0.5f, h * 0.1f)
                lineTo(w * 0.86f, h * 0.26f)
                lineTo(w * 0.86f, h * 0.52f)
                cubicTo(w * 0.86f, h * 0.74f, w * 0.68f, h * 0.86f, w * 0.5f, h * 0.92f)
                cubicTo(w * 0.32f, h * 0.86f, w * 0.14f, h * 0.74f, w * 0.14f, h * 0.52f)
                lineTo(w * 0.14f, h * 0.26f)
                close()
            },
            tint,
            style = pen,
        )
        drawLine(tint, Offset(w * 0.36f, h * 0.5f), Offset(w * 0.46f, h * 0.62f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.46f, h * 0.62f), Offset(w * 0.66f, h * 0.38f), stroke, StrokeCap.Round)
    }
}

/** Padlock, for the pairing-code field. */
@Composable
fun IconLock(modifier: Modifier = Modifier.size(22.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        val pen = outline(stroke)
        drawRoundRect(
            color = tint,
            topLeft = Offset(w * 0.18f, h * 0.44f),
            size = Size(w * 0.64f, h * 0.44f),
            cornerRadius = CornerRadius(w * 0.1f),
            style = pen,
        )
        drawArc(
            color = tint,
            startAngle = 180f,
            sweepAngle = 180f,
            useCenter = false,
            topLeft = Offset(w * 0.3f, h * 0.14f),
            size = Size(w * 0.4f, h * 0.44f),
            style = pen,
        )
    }
}

/** Chevron, for navigable rows. */
@Composable
fun IconChevron(modifier: Modifier = Modifier.size(18.dp), tint: Color = LocalContentColor.current) {
    Glyph(modifier, tint) { stroke ->
        val w = size.width
        val h = size.height
        drawLine(tint, Offset(w * 0.36f, h * 0.24f), Offset(w * 0.64f, h * 0.5f), stroke, StrokeCap.Round)
        drawLine(tint, Offset(w * 0.64f, h * 0.5f), Offset(w * 0.36f, h * 0.76f), stroke, StrokeCap.Round)
    }
}

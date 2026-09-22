package org.opensource.tracker.ui

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/**
 * Formatting helpers.
 *
 * Ties everything to the device's own time zone and locale, so a technician sees wall
 * clock times they recognise rather than server UTC.
 */

val deviceZone: ZoneId get() = ZoneId.systemDefault()

private val timeFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
private val dateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.getDefault())
private val shortDateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())
private val monthFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault())
private val secondsFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm:ss a", Locale.getDefault())

/**
 * Parses the ISO-8601 timestamps the API returns. It tolerates a plain UTC instant, an
 * offset timestamp, and a local date-time without a zone, so one malformed row can never
 * blank out the whole trip list.
 */
fun parseMoment(raw: String?): Instant? {
    if (raw.isNullOrBlank()) return null
    val value = raw.trim()
    return runCatching { Instant.parse(value) }
        .recoverCatching { OffsetDateTime.parse(value).toInstant() }
        .recoverCatching { LocalDateTime.parse(value).atZone(deviceZone).toInstant() }
        .recoverCatching { LocalDate.parse(value).atStartOfDay(deviceZone).toInstant() }
        .getOrNull()
}

fun Instant.timeLabel(): String = atZone(deviceZone).format(timeFormat)
fun Instant.dateLabel(): String = atZone(deviceZone).format(dateFormat)
fun Instant.shortDateLabel(): String = atZone(deviceZone).format(shortDateFormat)
fun Instant.localDate(): LocalDate = atZone(deviceZone).toLocalDate()

fun localDateLabel(date: LocalDate): String = date.format(dateFormat)
fun localDateShortLabel(date: LocalDate): String = date.format(shortDateFormat)
fun localDateMonthLabel(date: LocalDate): String = date.format(monthFormat)

/** "Today", "Yesterday", or a weekday heading for older history. */
fun dayHeading(date: LocalDate): String = when (date) {
    LocalDate.now() -> "Today"
    LocalDate.now().minusDays(1L) -> "Yesterday"
    else -> date.format(DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.getDefault()))
}

/** Monday-based week containing [date], which is how field rosters are usually read. */
fun weekRange(date: LocalDate): Pair<LocalDate, LocalDate> {
    val start = date.with(TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))
    return start to start.plusDays(6)
}

/** Wall-clock time from an epoch-millis value, used for values stored in preferences. */
fun millisToTimeLabel(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(deviceZone).format(timeFormat)

fun millisToSecondsLabel(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(deviceZone).format(secondsFormat)

/** "12.8 km" from a metre value. */
fun formatKilometres(meters: Double): String = String.format(Locale.getDefault(), "%.1f km", meters / 1000.0)

/** "12.8 km" from an already-kilometre value. */
fun formatKilometres(km: Float): String = String.format(Locale.getDefault(), "%.1f km", km)

/** "26 min" or "1h 37m". */
fun formatDuration(seconds: Int): String {
    if (seconds <= 0) return "0 min"
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return when {
        hours > 0 && minutes > 0 -> "${hours}h ${minutes}m"
        hours > 0 -> "${hours}h"
        else -> "$minutes min"
    }
}

fun formatSpeed(kilometresPerHour: Float): String = String.format(Locale.getDefault(), "%.0f km/h", kilometresPerHour)

fun formatSpeed(kilometresPerHour: Double): String = formatSpeed(kilometresPerHour.toFloat())

fun formatAccuracy(meters: Float): String = String.format(Locale.getDefault(), "±%.0f m", meters)

/** "12 seconds ago" / "4 min ago" / "—" when nothing has arrived yet. */
fun relativeTimeLabel(millis: Long, now: Long = System.currentTimeMillis()): String {
    if (millis <= 0L) return "No fix yet"
    val seconds = ((now - millis) / 1000L).coerceAtLeast(0L)
    return when {
        seconds < 10 -> "Just now"
        seconds < 60 -> "$seconds seconds ago"
        seconds < 3600 -> "${seconds / 60} min ago"
        seconds < 86400 -> "${seconds / 3600}h ago"
        else -> "${seconds / 86400}d ago"
    }
}

/** Compass point plus bearing, e.g. "NE · 045°". */
fun headingLabel(degrees: Float): String {
    if (degrees < 0f) return "—"
    val points = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    val index = (((degrees % 360f) + 360f) % 360f / 45f).toInt() % 8
    return String.format(Locale.getDefault(), "%s · %03.0f°", points[index], degrees % 360f)
}

/** Battery label with a charging marker. */
fun batteryLabel(level: Int, charging: Boolean): String = when {
    level <= 0 -> "—"
    charging -> "$level% ⚡"
    else -> "$level%"
}

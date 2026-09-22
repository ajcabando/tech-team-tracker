package org.opensource.tracker

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Lightweight on-device mirror of the server trip detector. It keeps the technician
 * dashboard live (trip started/ended, distance today) without waiting for a round trip,
 * while the server remains the source of truth for stored trips.
 */
class TripDetector(
    private val stopTimeoutMillis: Long = 5 * 60 * 1000L,
    private val movementThresholdMps: Double = 1.4,
    private val minStopMillis: Long = 60 * 1000L
) {
    enum class State { IDLE, MOVING }

    data class Update(
        val state: State,
        val tripStarted: Boolean,
        val tripEnded: Boolean,
        val stopStarted: Boolean,
        val distanceDeltaMeters: Double,
        val sessionDistanceMeters: Double
    )

    private var previousLatitude: Double? = null
    private var previousLongitude: Double? = null
    private var previousTime: Long = 0L
    private var state = State.IDLE
    private var lastMovingAt: Long = 0L
    private var stationarySince: Long = 0L
    private var sessionDistance = 0.0

    fun reset() {
        previousLatitude = null
        previousLongitude = null
        previousTime = 0L
        state = State.IDLE
        stationarySince = 0L
        sessionDistance = 0.0
    }

    fun onFix(latitude: Double, longitude: Double, reportedSpeedMps: Float, timeMillis: Long): Update {
        val previous = if (previousLatitude != null && previousLongitude != null) previousLatitude!! to previousLongitude!! else null
        var distanceDelta = 0.0
        if (previous != null && previousTime > 0) {
            val seconds = (timeMillis - previousTime) / 1000.0
            val meters = haversine(previous.first, previous.second, latitude, longitude)
            // Ignore physically impossible jumps rather than inflating the trip distance.
            if (seconds > 0 && meters / seconds < 97) distanceDelta = meters
        }

        val derivedSpeed = if (previous != null && previousTime > 0 && timeMillis > previousTime) {
            haversine(previous.first, previous.second, latitude, longitude) / ((timeMillis - previousTime) / 1000.0)
        } else 0.0
        val speed = max(derivedSpeed, reportedSpeedMps.toDouble())
        val moving = speed >= movementThresholdMps

        previousLatitude = latitude
        previousLongitude = longitude
        previousTime = timeMillis

        if (moving) {
            sessionDistance += distanceDelta
            lastMovingAt = timeMillis
            if (state == State.IDLE) {
                state = State.MOVING
                stationarySince = 0L
                return Update(State.MOVING, tripStarted = true, tripEnded = false, stopStarted = false, distanceDeltaMeters = distanceDelta, sessionDistanceMeters = sessionDistance)
            }
            val stopCompleted = stationarySince > 0 && timeMillis - stationarySince >= minStopMillis
            stationarySince = 0L
            return Update(State.MOVING, tripStarted = false, tripEnded = false, stopStarted = stopCompleted, distanceDeltaMeters = distanceDelta, sessionDistanceMeters = sessionDistance)
        }

        if (state == State.MOVING) {
            if (stationarySince == 0L) stationarySince = timeMillis
            if (timeMillis - stationarySince >= stopTimeoutMillis) {
                state = State.IDLE
                val distance = sessionDistance
                sessionDistance = 0.0
                return Update(State.IDLE, tripStarted = false, tripEnded = true, stopStarted = false, distanceDeltaMeters = distanceDelta, sessionDistanceMeters = distance)
            }
        }
        return Update(state, tripStarted = false, tripEnded = false, stopStarted = false, distanceDeltaMeters = distanceDelta, sessionDistanceMeters = sessionDistance)
    }

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val radius = 6_371_000.0
        val toRad = { value: Double -> value * Math.PI / 180 }
        val dLat = toRad(lat2 - lat1)
        val dLon = toRad(lon2 - lon1)
        val a = sin(dLat / 2).let { it * it } + cos(toRad(lat1)) * cos(toRad(lat2)) * sin(dLon / 2).let { it * it }
        return 2 * radius * asin(min(1.0, sqrt(a)))
    }
}

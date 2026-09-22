package org.opensource.tracker.ui

import android.content.Context
import org.opensource.tracker.RoutePoint
import org.opensource.tracker.TrackerApi

/**
 * Finished trip routes never change, so they are cached for the life of the process. That
 * lets trip details and route playback share one request instead of fetching twice while
 * the technician taps through screens.
 */
object RouteCache {
    private val routes = LinkedHashMap<String, List<RoutePoint>>()

    @Synchronized
    fun get(tripId: String): List<RoutePoint>? = routes[tripId]

    @Synchronized
    fun put(tripId: String, route: List<RoutePoint>) {
        routes[tripId] = route
    }
}

/**
 * Loads the recorded GPS track for a trip. Returns the failure unchanged when the server
 * cannot be reached, so the caller can tell the technician why the map is empty.
 */
suspend fun loadTripRoute(context: Context, tripId: String): Result<List<RoutePoint>> {
    RouteCache.get(tripId)?.let { return Result.success(it) }
    return TrackerApi(context).route(tripId).map { points -> points.also { RouteCache.put(tripId, it) } }
}

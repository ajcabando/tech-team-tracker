package org.opensource.tracker.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import org.opensource.tracker.R
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.ITileSource
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Overlay
import org.osmdroid.views.overlay.Polyline
import kotlin.math.log2

/** A coordinate pair, so screens never have to depend on an osmdroid type. */
data class LatLng(val latitude: Double, val longitude: Double)

/**
 * Everything a map can draw. All of it is real recorded data: [route] is the GPS track the
 * server stored for a trip, and [current] is the latest position the tracking service
 * received from the phone.
 */
data class MapTrack(
    val route: List<LatLng> = emptyList(),
    val start: LatLng? = null,
    val end: LatLng? = null,
    val current: LatLng? = null,
    val currentHeading: Float? = null,
    val currentIsVehicle: Boolean = false,
)

private const val ROUTE_COLOR = "#2F80ED"

/**
 * Candidate tile layers. They are resolved by name against osmdroid's registry so an
 * unavailable source can never crash the app — the control simply falls back and reports
 * the layer that was actually applied.
 */
private val LAYER_CANDIDATES = listOf("Mapnik", "Cycle Map", "CycleMap", "HikeBikeMap", "Hike Bike Map", "OpenTopoMap")

private fun resolveLayers(): List<ITileSource> {
    val resolved = LinkedHashMap<String, ITileSource>()
    LAYER_CANDIDATES.forEach { name ->
        runCatching { TileSourceFactory.getTileSource(name) }
            .getOrNull()
            ?.let { source -> resolved[source.name()] = source }
    }
    if (resolved.isEmpty()) resolved[TileSourceFactory.MAPNIK.name()] = TileSourceFactory.MAPNIK
    return resolved.values.toList()
}

/** Overlays are kept alive between updates so playback only moves a marker. */
private class OverlayHolder {
    var route: Polyline? = null
    var start: Marker? = null
    var end: Marker? = null
    var current: Marker? = null
    var routeKey: String = ""
    var currentKey: String = ""
}

/**
 * Imperative handle on the underlying map, used by the floating map controls.
 */
class MapControllerState {
    internal var mapView: MapView? = null
    internal val layers = mutableListOf<ITileSource>()
    internal var layerIndex = 0

    var layerLabel by mutableStateOf("Standard")
        private set

    /** True once the underlying MapView exists and can be driven by the controls. */
    val isReady: Boolean get() = mapView != null

    /**
     * Zooms out just far enough to show an entire recorded route, so a trip opens framed
     * instead of centred on its first point.
     */
    fun fitBounds(points: List<LatLng>) {
        if (points.isEmpty()) return
        val minLat = points.minOf { it.latitude }
        val maxLat = points.maxOf { it.latitude }
        val minLng = points.minOf { it.longitude }
        val maxLng = points.maxOf { it.longitude }
        val centre = LatLng((minLat + maxLat) / 2.0, (minLng + maxLng) / 2.0)
        // The widest span decides the zoom; the floor keeps a stationary route from
        // zooming all the way in.
        val span = maxOf(maxLat - minLat, maxLng - minLng).coerceAtLeast(0.0015)
        val zoom = (log2(360.0 / span) - 0.6).coerceIn(3.0, 17.5)
        centreOn(centre, zoom)
    }

    fun zoomIn() {
        mapView?.controller?.zoomIn()
    }

    fun zoomOut() {
        mapView?.controller?.zoomOut()
    }

    /** Recentre without animation, which is predictable on slow devices. */
    fun centreOn(target: LatLng, zoom: Double = 15.0) {
        val view = mapView ?: return
        runCatching {
            view.controller.setZoom(zoom)
            view.controller.setCenter(GeoPoint(target.latitude, target.longitude))
            view.invalidate()
        }
    }

    fun cycleLayer() {
        val view = mapView ?: return
        if (layers.isEmpty()) layers.addAll(resolveLayers())
        layerIndex = (layerIndex + 1) % layers.size
        val source = layers[layerIndex]
        runCatching { view.setTileSource(source) }
        layerLabel = source.name()
        view.invalidate()
    }

    internal fun applyInitialLayer(view: MapView) {
        if (layers.isEmpty()) {
            layers.addAll(resolveLayers())
            layerLabel = layers.firstOrNull()?.name() ?: "Standard"
        }
        runCatching { view.setTileSource(layers[layerIndex]) }
    }
}

@Composable
fun rememberMapController(): MapControllerState = remember { MapControllerState() }

private fun configureOsmdroid(context: Context) {
    val configuration = Configuration.getInstance()
    // osmdroid needs a writable base path and tile cache before it can store tiles;
    // load() fills in the app-private defaults when nothing has been configured yet.
    runCatching {
        configuration.load(context, context.getSharedPreferences("osmdroid", Context.MODE_PRIVATE))
    }
    // OpenStreetMap's tile policy requires an identifying user agent.
    configuration.userAgentValue = context.packageName
}

private fun createMapView(context: Context, zoom: Double, centre: LatLng?): MapView {
    configureOsmdroid(context)
    return MapView(context).apply {
        setMultiTouchControls(true)
        setBuiltInZoomControls(false)
        controller.setZoom(zoom)
        centre?.let { controller.setCenter(GeoPoint(it.latitude, it.longitude)) }
    }
}

private fun MapView.addOverlay(overlay: Overlay) {
    if (!overlays.contains(overlay)) overlays.add(overlay)
}

private fun MapView.marker(iconRes: Int, point: LatLng, title: String, centerAnchor: Boolean = false): Marker {
    val density = resources.displayMetrics.density
    val size = (30 * density).toInt()
    return Marker(this).apply {
        setAnchor(Marker.ANCHOR_CENTER, if (centerAnchor) Marker.ANCHOR_CENTER else Marker.ANCHOR_BOTTOM)
        position = GeoPoint(point.latitude, point.longitude)
        this.title = title
        ContextCompat.getDrawable(context, iconRes)?.let { drawable ->
            drawable.setBounds(0, 0, size, size)
            icon = drawable
        }
    }
}

private fun routeSignature(route: List<LatLng>): String =
    if (route.isEmpty()) {
        "empty"
    } else {
        val first = route.first()
        val last = route.last()
        "${route.size}:${"%.5f".format(first.latitude)},${"%.5f".format(first.longitude)}:" +
            "${"%.5f".format(last.latitude)},${"%.5f".format(last.longitude)}"
    }

private fun applyTrack(view: MapView, holder: OverlayHolder, track: MapTrack) {
    var dirty = false

    val routeKey = routeSignature(track.route)
    if (routeKey != holder.routeKey) {
        holder.routeKey = routeKey
        if (track.route.isEmpty()) {
            holder.route?.let { view.overlays.remove(it) }
            holder.route = null
            holder.start?.let { view.overlays.remove(it) }
            holder.start = null
            holder.end?.let { view.overlays.remove(it) }
            holder.end = null
        } else {
            val line = holder.route ?: Polyline(view).also {
                view.addOverlay(it)
                holder.route = it
            }
            line.setPoints(track.route.map { GeoPoint(it.latitude, it.longitude) })
            line.outlinePaint.color = android.graphics.Color.parseColor(ROUTE_COLOR)
            line.outlinePaint.strokeWidth = 9f

            holder.start?.let { view.overlays.remove(it) }
            holder.start = track.start?.let { point ->
                view.marker(R.drawable.ic_marker_start, point, "Start").also { view.addOverlay(it) }
            }
            holder.end?.let { view.overlays.remove(it) }
            holder.end = track.end?.let { point ->
                view.marker(R.drawable.ic_marker_end, point, "End").also { view.addOverlay(it) }
            }
        }
        dirty = true
    }

    val currentKey = track.current?.let {
        "${"%.5f".format(it.latitude)},${"%.5f".format(it.longitude)}:${track.currentHeading}:${track.currentIsVehicle}"
    } ?: ""
    if (currentKey != holder.currentKey) {
        holder.currentKey = currentKey
        val point = track.current
        if (point == null) {
            holder.current?.let { view.overlays.remove(it) }
            holder.current = null
        } else {
            val marker = holder.current ?: view.marker(
                if (track.currentIsVehicle) R.drawable.ic_marker_car else R.drawable.ic_marker_current,
                point,
                "Current position",
                centerAnchor = track.currentIsVehicle,
            ).also {
                view.addOverlay(it)
                holder.current = it
            }
            marker.position = GeoPoint(point.latitude, point.longitude)
            marker.rotation = track.currentHeading ?: 0f
        }
        dirty = true
    }

    if (dirty) view.invalidate()
}

/**
 * The shared map. Used by the live map, trip details and route playback so all three look
 * and behave identically.
 */
@Composable
fun TrackerMap(
    track: MapTrack,
    modifier: Modifier = Modifier,
    controller: MapControllerState = rememberMapController(),
    initialZoom: Double = 14.0,
    followCurrent: Boolean = false,
    attributionPadding: PaddingValues = PaddingValues(8.dp),
) {
    val holder = remember { OverlayHolder() }

    Box(modifier) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                val centre = track.current ?: track.start ?: track.route.firstOrNull()
                createMapView(viewContext, initialZoom, centre).also { view ->
                    controller.mapView = view
                    controller.applyInitialLayer(view)
                    applyTrack(view, holder, track)
                }
            },
            update = { view ->
                applyTrack(view, holder, track)
                // Route playback keeps the moving technician on screen.
                if (followCurrent) track.current?.let { controller.centreOn(it, view.zoomLevelDouble) }
            },
        )

        // Required by the OpenStreetMap tile licence.
        Text(
            text = stringResource(R.string.map_attribution),
            style = MaterialTheme.typography.labelSmall,
            color = TrackerColors.InkMuted,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(attributionPadding)
                .clip(RoundedCornerShape(4.dp))
                .background(Color.White.copy(alpha = 0.75f))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }

    DisposableEffect(controller) {
        onDispose {
            runCatching { controller.mapView?.onDetach() }
            controller.mapView = null
        }
    }
}

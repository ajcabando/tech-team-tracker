package org.opensource.tracker.ui

/**
 * Every screen in Tech Team Tracker.
 *
 * The technician phone is deliberately minimal: a status screen and the locked
 * admin settings behind a password gate. There is no bottom navigation and no
 * trip, map or notification browsing on the device — those live on the admin
 * dashboard.
 */
enum class TrackerPage {
    SPLASH,
    PAIRING,
    STATUS,
    GATE,
    ADMIN_SETTINGS;

    /** True for pages the system back gesture must not leave. */
    val isLocked: Boolean get() = this == SPLASH || this == PAIRING || this == STATUS

    /** The dark field shell is used by the splash and the status screen only. */
    val isDark: Boolean get() = this == SPLASH || this == STATUS

    /** Where the system back gesture returns to. */
    val parent: TrackerPage
        get() = when (this) {
            GATE -> STATUS
            ADMIN_SETTINGS -> STATUS
            else -> STATUS
        }
}

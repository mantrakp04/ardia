package com.ardia.appmodel

import android.content.Intent
import android.os.Bundle

data class LaunchArguments(
    val isDemo: Boolean = false,
    val browseOpen: String? = null,
    val browseQuery: String? = null,
    val browseSurface: String? = null,
    val browseTab: Int? = null,
    val browseToolbar: Boolean = false,
    val browseReader: Boolean = false,
    val browseIncognito: Boolean = false,
    val browseDelaySeconds: Double = DEFAULT_DELAY_SECONDS,
    val browseDeck: Boolean = false,
    val browseDeckOpen: Int? = null,
    val browsePlus: Boolean = false,
    val browseOverlay: String? = null,
    val browseSteps: List<Int> = emptyList(),
    val browseStepGapSeconds: Double = DEFAULT_STEP_GAP_SECONDS,
    val deckScript: String? = null,
    val showsOnboarding: Boolean = false,
    val openSheet: String? = null,
    val opensSettings: Boolean = false,
    val restingStart: Boolean = false,
    val color: String? = null,
    val toast: String? = null,
    val trustedSitesSample: Boolean = false,
    val pagerFreeze: Double? = null,
    val pagerScript: Boolean = false,
    val loadFreeze: Double? = null,
) {
    val browseDelayMillis: Long get() = (browseDelaySeconds * 1000).toLong()

    companion object {
        const val DEFAULT_DELAY_SECONDS = 6.0
        const val DEFAULT_STEP_GAP_SECONDS = 1.5

        const val ARDIA_DEMO = "ArdiaDemo"
        const val BROWSE_OPEN = "BrowseOpen"
        const val BROWSE_QUERY = "BrowseQuery"
        const val BROWSE_SURFACE = "BrowseSurface"
        const val BROWSE_TAB = "BrowseTab"
        const val BROWSE_TOOLBAR = "BrowseToolbar"
        const val BROWSE_READER = "BrowseReader"
        const val BROWSE_INCOGNITO = "BrowseIncognito"
        const val BROWSE_DELAY = "BrowseDelay"
        const val BROWSE_DECK = "BrowseDeck"
        const val BROWSE_DECK_OPEN = "BrowseDeckOpen"
        const val BROWSE_PLUS = "BrowsePlus"
        const val BROWSE_OVERLAY = "BrowseOverlay"
        const val BROWSE_STEPS = "BrowseSteps"
        const val BROWSE_STEP_GAP = "BrowseStepGap"
        const val ARDIA_DECK = "ArdiaDeck"
        const val ARDIA_ONBOARDING = "ArdiaOnboarding"
        const val ARDIA_OPEN_SHEET = "ArdiaOpenSheet"
        const val ARDIA_OPEN_SETTINGS = "ArdiaOpenSettings"
        const val ARDIA_RESTING_START = "ArdiaRestingStart"
        const val ARDIA_COLOR = "ArdiaColor"
        const val ARDIA_TOAST = "ArdiaToast"
        const val ARDIA_TRUSTED_SITES = "ArdiaTrustedSites"
        const val BROWSE_PAGER_FREEZE = "BrowsePagerFreeze"
        const val BROWSE_PAGER_SCRIPT = "BrowsePagerScript"
        const val BROWSE_LOAD_FREEZE = "BrowseLoadFreeze"

        val none = LaunchArguments()

        fun fromIntent(intent: Intent?): LaunchArguments = fromBundle(intent?.extras)

        fun fromBundle(extras: Bundle?): LaunchArguments {
            if (extras == null) return none
            @Suppress("DEPRECATION")
            return parse(extras.keySet().associateWith { extras.get(it) })
        }

        fun parse(values: Map<String, Any?>): LaunchArguments {
            fun text(key: String): String? = values[key]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            fun flag(key: String): Boolean = when (val value = values[key]) {
                null -> false
                is Boolean -> value
                is Number -> value.toInt() != 0
                else -> value.toString().trim().lowercase() !in setOf("false", "no", "0")
            }
            fun number(key: String): Double? = text(key)?.toDoubleOrNull()
            fun whole(key: String): Int? = number(key)?.toInt()
            val isDemo = flag(ARDIA_DEMO)
            return LaunchArguments(
                isDemo = isDemo,
                browseOpen = text(BROWSE_OPEN),
                browseQuery = values[BROWSE_QUERY]?.toString(),
                browseSurface = text(BROWSE_SURFACE),
                browseTab = whole(BROWSE_TAB),
                browseToolbar = flag(BROWSE_TOOLBAR),
                browseReader = flag(BROWSE_READER),
                browseIncognito = flag(BROWSE_INCOGNITO),
                browseDelaySeconds = number(BROWSE_DELAY) ?: DEFAULT_DELAY_SECONDS,
                browseDeck = flag(BROWSE_DECK),
                browseDeckOpen = whole(BROWSE_DECK_OPEN),
                browsePlus = flag(BROWSE_PLUS),
                browseOverlay = values[BROWSE_OVERLAY]?.toString(),
                browseSteps = text(BROWSE_STEPS)?.split(',')?.mapNotNull { it.trim().toIntOrNull() }.orEmpty(),
                browseStepGapSeconds = number(BROWSE_STEP_GAP) ?: DEFAULT_STEP_GAP_SECONDS,
                deckScript = text(ARDIA_DECK),
                showsOnboarding = flag(ARDIA_ONBOARDING),
                openSheet = text(ARDIA_OPEN_SHEET),
                opensSettings = flag(ARDIA_OPEN_SETTINGS),
                restingStart = flag(ARDIA_RESTING_START),
                color = text(ARDIA_COLOR),
                toast = text(ARDIA_TOAST),
                trustedSitesSample = flag(ARDIA_TRUSTED_SITES),
                pagerFreeze = if (isDemo) number(BROWSE_PAGER_FREEZE) else null,
                pagerScript = isDemo && flag(BROWSE_PAGER_SCRIPT),
                loadFreeze = if (isDemo) number(BROWSE_LOAD_FREEZE) else null,
            )
        }
    }
}

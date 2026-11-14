package com.ardia.appmodel

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.store.AppPreferences
import com.ardia.store.AppSettings
import com.ardia.store.ColorChoice

enum class SettingsRoute {
    Sync,
    SiteSettings,
    Connect,
    SearchEngine,
    FilterLists,
    FilterListDetail,
    MyFilters,
    TrustedSites,
    ClearData,
    DefaultBrowser,
    About,
    Licenses,
}

@Stable
class SettingsModel(private val preferences: AppPreferences) {
    var values: AppSettings by mutableStateOf(preferences.settings.value)
        private set

    var isShowingOnboarding: Boolean by mutableStateOf(!values.hasFinishedOnboarding)
    var pendingRoute: SettingsRoute? by mutableStateOf(null)

    var collapsesBottomBar: Boolean
        get() = values.collapsesBottomBar
        set(value) = write { preferences.setCollapsesBottomBar(value) }

    var autoOpensKeyboard: Boolean
        get() = values.autoOpensKeyboard
        set(value) = write { preferences.setAutoOpensKeyboard(value) }

    val hasFinishedOnboarding: Boolean get() = values.hasFinishedOnboarding

    var colorChoice: String?
        get() = values.colorChoice?.raw
        set(value) = write { preferences.setColorChoice(ColorChoice.of(value)) }

    val matchesMac: Boolean get() = values.matchesMac

    fun finishOnboarding() {
        write { preferences.finishOnboarding() }
        isShowingOnboarding = false
    }

    fun showOnboarding() {
        isShowingOnboarding = true
    }

    internal fun refresh() {
        values = preferences.settings.value
    }

    private fun write(change: () -> Unit) {
        change()
        refresh()
    }
}

package com.ardia.browser.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Modifier
import com.ardia.appmodel.AppModel
import com.ardia.browsing.BrowsingView
import com.ardia.search.SearchHomeView
import com.ardia.search.SearchTrayHost
import com.ardia.search.VoiceSearchView
import com.ardia.settings.OnboardingView
import com.ardia.settings.SettingsView
import com.ardia.settings.SyncSetupView
import com.ardia.tabs.ArchiveView
import com.ardia.tabs.SyncedSpacesView
import com.ardia.tabs.TabSwitcherView

@Immutable
class RootScreens(
    val searchStart: @Composable (AppModel, Modifier) -> Unit,
    val searchTray: @Composable (AppModel, Modifier) -> Unit,
    val voiceSearch: @Composable (AppModel) -> Unit,
    val browsing: @Composable (AppModel, Boolean, Modifier) -> Unit,
    val tabDeck: @Composable (AppModel, Modifier) -> Unit,
    val archive: @Composable (AppModel) -> Unit,
    val syncedSpaces: @Composable (AppModel) -> Unit,
    val settings: @Composable (AppModel) -> Unit,
    val syncSetup: @Composable (AppModel) -> Unit,
    val onboarding: @Composable (AppModel) -> Unit,
) {
    companion object {
        val app = RootScreens(
            searchStart = { model, modifier -> SearchHomeView(model, modifier) },
            searchTray = { model, modifier -> SearchTrayHost(model, modifier) },
            voiceSearch = { model -> VoiceSearchView(model, Modifier.fillMaxSize()) },
            browsing = { model, isFront, modifier -> BrowsingView(model, isFront, modifier) },
            tabDeck = { model, modifier -> TabSwitcherView(model, modifier) },
            archive = { model -> ArchiveView(model, Modifier.fillMaxSize()) },
            syncedSpaces = { model -> SyncedSpacesView(model, Modifier.fillMaxSize()) },
            settings = { model -> SettingsView(model, Modifier.fillMaxSize()) },
            syncSetup = { model -> SyncSetupView(model, Modifier.fillMaxSize()) },
            onboarding = { model -> OnboardingView(model, Modifier.fillMaxSize()) },
        )
    }
}

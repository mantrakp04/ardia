package com.ardia.browser.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
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

@Composable
fun SearchStart(model: AppModel, modifier: Modifier) = SearchHomeView(model, modifier)

@Composable
fun SearchTray(model: AppModel, modifier: Modifier) = SearchTrayHost(model, modifier)

@Composable
fun VoiceSearch(model: AppModel) = VoiceSearchView(model, Modifier.fillMaxSize())

@Composable
fun BrowsingSurface(model: AppModel, isFront: Boolean, modifier: Modifier) = BrowsingView(model, isFront, modifier)

@Composable
fun TabDeck(model: AppModel, modifier: Modifier) = TabSwitcherView(model, modifier)

@Composable
fun ArchiveSheet(model: AppModel) = ArchiveView(model, Modifier.fillMaxSize())

@Composable
fun SyncedSpacesSheet(model: AppModel) = SyncedSpacesView(model, Modifier.fillMaxSize())

@Composable
fun SettingsSheet(model: AppModel) = SettingsView(model, Modifier.fillMaxSize())

@Composable
fun SyncSetupSheet(model: AppModel) = SyncSetupView(model, Modifier.fillMaxSize())

@Composable
fun Onboarding(model: AppModel) = OnboardingView(model, Modifier.fillMaxSize())

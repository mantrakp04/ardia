package com.ardia.appmodel

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

@Stable
class DefaultBrowserStatus(private val system: SystemActions, private val asksSystem: Boolean) {
    var isDefault: Boolean by mutableStateOf(false)
        private set
    var isOffered: Boolean by mutableStateOf(false)
        private set
    private var awaitingSettingsReturn = false

    fun willOpenSystemSettings() {
        awaitingSettingsReturn = true
    }

    fun receivedLinkFromSystem() {
        refresh()
    }

    fun sceneBecameActive() {
        awaitingSettingsReturn = false
        refresh()
    }

    private fun refresh() {
        if (!asksSystem) return
        val answer = system.isDefaultBrowser()
        isOffered = answer != null
        isDefault = answer == true
    }
}

package com.ardia.settings

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.appmodel.SettingsRoute

@Immutable
sealed interface SettingsDestination {
    val key: String

    data class Page(val route: SettingsRoute) : SettingsDestination {
        override val key: String get() = route.name
    }

    data class FilterList(val id: String) : SettingsDestination {
        override val key: String get() = "list:$id"
    }

    data object EnterWords : SettingsDestination {
        override val key: String get() = "words"
    }

    companion object {
        const val DEFAULT_FILTER_LIST = "ublock-filters"

        fun of(route: SettingsRoute): SettingsDestination =
            if (route == SettingsRoute.FilterListDetail) FilterList(DEFAULT_FILTER_LIST) else Page(route)
    }
}

@Stable
class SettingsBackStack(initial: List<SettingsDestination> = emptyList()) {
    var entries: List<SettingsDestination> by mutableStateOf(initial)
        private set

    var isPopping: Boolean by mutableStateOf(false)
        private set

    val top: SettingsDestination? get() = entries.lastOrNull()

    val isAtRoot: Boolean get() = entries.isEmpty()

    fun push(destination: SettingsDestination) {
        if (entries.lastOrNull() == destination) return
        isPopping = false
        entries = entries + destination
    }

    fun push(route: SettingsRoute) = push(SettingsDestination.of(route))

    fun pop(): Boolean {
        if (entries.isEmpty()) return false
        isPopping = true
        entries = entries.dropLast(1)
        return true
    }

    fun popTo(predicate: (SettingsDestination) -> Boolean) {
        val index = entries.indexOfLast(predicate)
        if (index < 0 || index == entries.lastIndex) return
        isPopping = true
        entries = entries.take(index + 1)
    }

    fun replaceAll(destinations: List<SettingsDestination>) {
        isPopping = false
        entries = destinations
    }

    fun takePending(route: SettingsRoute?): Boolean {
        route ?: return false
        replaceAll(listOf(SettingsDestination.of(route)))
        return true
    }
}

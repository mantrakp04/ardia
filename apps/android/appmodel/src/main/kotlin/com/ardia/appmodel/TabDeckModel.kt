package com.ardia.appmodel

import android.graphics.Bitmap
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.store.AppPreferences
import java.util.concurrent.atomic.AtomicLong

@Stable
class TabDeckModel(private val preferences: AppPreferences) {
    data class Handoff(val tabId: String, val image: Bitmap)

    sealed interface Entrance {
        data class FromPage(val tabId: String) : Entrance

        data object Plain : Entrance
    }

    data class Command(val kind: Kind, val id: Long = nextId.incrementAndGet()) {
        sealed interface Kind {
            data class Scroll(val index: Int) : Kind

            data object CloseFocused : Kind

            data object OpenFocused : Kind

            data object ShowArchiveCard : Kind

            data class Lift(val offset: Double) : Kind
        }
    }

    var handoff: Handoff? by mutableStateOf(null)
    var entrance: Entrance by mutableStateOf(Entrance.Plain)
    var command: Command? by mutableStateOf(null)

    var hasShownArchiveCard: Boolean
        get() = preferences.settings.value.archiveCardShown
        set(value) = preferences.setArchiveCardShown(value)

    fun shouldOfferArchiveCard(openTabs: Int): Boolean = !hasShownArchiveCard && openTabs >= ARCHIVE_CARD_THRESHOLD

    fun memoryImage(id: String): Bitmap? = handoff?.takeIf { it.tabId == id }?.image

    fun forget(ids: Set<String>) {
        if (handoff?.tabId in ids) handoff = null
    }

    companion object {
        const val ARCHIVE_CARD_THRESHOLD = 8
        private val nextId = AtomicLong()
    }
}

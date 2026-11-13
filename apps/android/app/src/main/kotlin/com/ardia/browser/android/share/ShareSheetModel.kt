package com.ardia.browser.android.share

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.appmodel.SystemLink
import com.ardia.browser.android.system.SystemDevice
import com.ardia.browser.android.system.SystemSnapshot
import com.ardia.browser.android.system.SystemTab
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class SharedPage(val url: String?, val title: String, val text: String?) {
    val host: String? get() = url?.let { SystemTab("", it).host }

    val displayTitle: String
        get() = title.trim().ifEmpty { host ?: text.orEmpty() }

    companion object {
        private val link = Regex("(?i)\\bhttps?://[^\\s<>\"]+")
        private const val TRAILING = ".,;:!?)]}'\""

        fun from(text: String?, subject: String?): SharedPage {
            val clean = text?.trim()?.ifEmpty { null }
            val url = clean?.let(::firstLink)
            var title = subject?.trim().orEmpty()
            if (title.isEmpty() && url != null && clean != url) title = clean
            if (title == url) title = ""
            return SharedPage(url, title, clean)
        }

        fun firstLink(text: String): String? = link.find(text)?.value?.trimEnd { it in TRAILING }?.takeIf { it.substringAfter("://").isNotEmpty() }
    }
}

@Stable
class ShareSheetModel(
    val page: SharedPage,
    val snapshot: SystemSnapshot,
    private val scope: CoroutineScope,
    private val open: (String) -> Boolean,
    private val send: suspend (SharedPage, SystemDevice) -> Boolean,
    private val finish: () -> Unit,
    val cancel: () -> Unit,
) {
    sealed interface Phase {
        data object Ready : Phase

        data class Sending(val device: SystemDevice) : Phase

        data class Done(val message: Message, val succeeded: Boolean) : Phase
    }

    sealed interface Message {
        data class Sent(val deviceName: String) : Message

        data class CouldNotSend(val deviceName: String) : Message

        data object CouldNotOpen : Message
    }

    var phase: Phase by mutableStateOf(Phase.Ready)
        private set
    var completions by mutableIntStateOf(0)
        private set
    var failures by mutableIntStateOf(0)
        private set

    val hasContent: Boolean get() = page.url != null || page.text != null

    val opensPage: Boolean get() = page.url != null

    val sendTargets: List<SystemDevice>
        get() = if (snapshot.isSyncEnabled && page.url != null) snapshot.sendTargets else emptyList()

    val offersSyncHint: Boolean get() = page.url != null && !snapshot.isSyncEnabled

    val sendsOnlyToMacs: Boolean get() = sendTargets.all { it.isMac }

    fun openInArdia() {
        val link = page.url?.let { SystemLink.Open(it).uri } ?: page.text?.let { SystemLink.Search(it).uri } ?: return
        if (open(link)) finish() else confirm(Message.CouldNotOpen, succeeded = false)
    }

    fun send(device: SystemDevice) {
        if (phase != Phase.Ready || page.url == null) return
        phase = Phase.Sending(device)
        scope.launch {
            val sent = runCatching { send(page, device) }.getOrDefault(false)
            confirm(if (sent) Message.Sent(device.name) else Message.CouldNotSend(device.name), sent)
        }
    }

    private fun confirm(message: Message, succeeded: Boolean) {
        phase = Phase.Done(message, succeeded)
        if (succeeded) completions++ else failures++
        scope.launch {
            delay(CONFIRMATION_DELAY_MILLIS)
            finish()
        }
    }

    companion object {
        const val CONFIRMATION_DELAY_MILLIS = 1_400L
    }
}

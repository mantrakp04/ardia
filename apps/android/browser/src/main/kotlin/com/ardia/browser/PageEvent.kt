package com.ardia.browser

import android.os.Message

enum class VisitKind {
    Typed,
    Link,
    BackForward,
    Restored,
    Redirect,
    SameDocument,
}

data class PageDownload(
    val url: String,
    val fileName: String,
    val mimeType: String?,
    val contentLength: Long,
    val userAgent: String?,
    val contentDisposition: String?,
    val referer: String?,
    val isPrivate: Boolean,
    val privateSession: String? = null,
)

sealed interface PressTarget {
    val url: String

    data class Link(override val url: String, val text: String?) : PressTarget

    data class Image(override val url: String, val linkUrl: String?) : PressTarget
}

class PopupRequest internal constructor(
    val url: String?,
    val isUserGesture: Boolean,
    val isPrivate: Boolean,
    val openerId: String,
    internal val transport: Message,
) {
    @Volatile
    internal var isClaimed = false
}

sealed interface PageEvent {
    data class Visited(val url: String, val title: String, val kind: VisitKind) : PageEvent

    data class OpenWindow(val popup: PopupRequest) : PageEvent

    data class Download(val download: PageDownload) : PageEvent

    data class LongPress(val target: PressTarget, val x: Float, val y: Float) : PageEvent

    data object CloseRequested : PageEvent

    data class ExternalAppMissing(val url: String) : PageEvent
}

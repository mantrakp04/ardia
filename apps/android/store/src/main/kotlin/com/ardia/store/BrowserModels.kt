package com.ardia.store

import java.util.UUID

enum class TabOrigin(val raw: String) {
    TYPED("typed"),
    SEARCH("search"),
    LINK("link"),
    SYNC("sync"),
    SHARE("share"),
    SENT("sent");

    companion object {
        fun of(raw: String?): TabOrigin = entries.firstOrNull { it.raw == raw } ?: TYPED
    }
}

enum class VisitTransition(val raw: String) {
    TYPED("typed"),
    LINK("link"),
    BACK_FORWARD("backForward"),
    FORM_SUBMIT("formSubmit"),
    RESTORED("restored"),
    OTHER("other");

    companion object {
        fun of(raw: String?): VisitTransition = entries.firstOrNull { it.raw == raw } ?: OTHER
    }
}

data class BrowserTab(
    val id: String,
    val url: String,
    val title: String = "",
    val created: Long,
    val lastActive: Long = created,
    val archivedAt: Long? = null,
    val position: Double = 0.0,
    val profileSyncId: String? = null,
    val faviconUrl: String? = null,
    val themeColorHex: String? = null,
    val snapshotFileName: String? = null,
    val origin: TabOrigin = TabOrigin.TYPED,
    val receivedKey: String? = null,
    val receivedFromDevice: String? = null,
    val isPrivate: Boolean = false,
) {
    val isArchived: Boolean get() = archivedAt != null

    companion object {
        fun newId(): String = UUID.randomUUID().toString().uppercase()
    }
}

data class Visit(
    val id: Long,
    val url: String,
    val title: String,
    val visitedAt: Long,
    val profileSyncId: String?,
    val transition: VisitTransition,
)

data class TabRecord(val url: String, val title: String, val lastActive: Long, val profileSyncId: String?)

data class VisitRecord(val url: String, val title: String, val visitedAt: List<Long>, val profileSyncId: String?)

data class IncomingTab(
    val key: String,
    val url: String,
    val title: String,
    val fromDevice: String,
    val sentAt: Long,
    val profileSyncId: String,
    val fromDeviceId: String = "",
)

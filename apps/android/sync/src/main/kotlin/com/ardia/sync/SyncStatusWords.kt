package com.ardia.sync

object SyncStatusText {
    const val RESET_MESSAGE = "This device is out of sync. Sync may have been reset from another device."

    fun of(phase: SyncPhase, lastSynced: Long?, pendingDownloads: Int, now: Long): String = when (phase) {
        SyncPhase.Off -> "Off"
        SyncPhase.Starting -> "Starting up"
        SyncPhase.Updating -> "Updating" + waiting(pendingDownloads)
        SyncPhase.Updated -> "Updated just now" + waiting(pendingDownloads)
        is SyncPhase.Stalled -> if (lastSynced == null) "Not syncing" else "Not syncing · Last synced ${RelativeTime.ago(lastSynced, now)}"
        SyncPhase.Offline -> "Offline"
        SyncPhase.NeedsFolderAccess -> "Choose your sync folder again to keep syncing."
        SyncPhase.Locked -> "Enter your recovery phrase to keep syncing on this phone."
        SyncPhase.Reset -> RESET_MESSAGE
    }

    fun waitingForDownloads(count: Int): String = if (count == 1) "Waiting for 1 file to download" else "Waiting for $count files to download"

    private fun waiting(count: Int): String = if (count > 0) " · " + waitingForDownloads(count) else ""
}

object RelativeTime {
    private val units = listOf(
        365L * 86_400 to "year",
        30L * 86_400 to "month",
        7L * 86_400 to "week",
        86_400L to "day",
        3_600L to "hour",
        60L to "minute",
    )

    fun ago(then: Long, now: Long): String {
        val seconds = maxOf(0L, (now - then) / 1000)
        val (size, unit) = units.firstOrNull { seconds >= it.first } ?: (1L to "second")
        val count = seconds / size
        return "$count $unit${if (count == 1L) "" else "s"} ago"
    }
}

data class SyncStatusLine(val text: String, val isWarning: Boolean)

data class SyncStatusWords(val phase: SyncPhase, val statusText: String, val isEnabled: Boolean) {
    enum class Attention { NONE, FOLDER, PHRASE, RESET, STALLED }

    val isOff: Boolean get() = phase == SyncPhase.Off

    val attention: Attention
        get() = when (phase) {
            SyncPhase.NeedsFolderAccess -> Attention.FOLDER
            SyncPhase.Locked -> Attention.PHRASE
            SyncPhase.Reset -> Attention.RESET
            is SyncPhase.Stalled -> Attention.STALLED
            else -> Attention.NONE
        }

    val rowTitle: String get() = "Sync With Mac"

    val rowSubtitle: SyncStatusLine
        get() = when (attention) {
            Attention.FOLDER -> SyncStatusLine("Choose Your Sync Folder Again", true)
            Attention.PHRASE -> SyncStatusLine("Enter Your Recovery Phrase", true)
            Attention.RESET -> SyncStatusLine("Out of Sync", true)
            Attention.STALLED -> SyncStatusLine(statusText, true)
            Attention.NONE -> SyncStatusLine(if (isOff) "Every tab, anywhere." else statusText, false)
        }

    val heroSubtitle: SyncStatusLine
        get() = when {
            isOff -> SyncStatusLine("Your Mac’s tabs here, and this phone’s on your Mac.", false)
            attention == Attention.NONE -> SyncStatusLine(statusText, false)
            else -> SyncStatusLine(statusText, true)
        }

    val isConnected: Boolean
        get() = when (phase) {
            SyncPhase.Starting, SyncPhase.Updating, SyncPhase.Updated, is SyncPhase.Stalled, SyncPhase.Offline, SyncPhase.NeedsFolderAccess -> isEnabled
            SyncPhase.Off, SyncPhase.Locked, SyncPhase.Reset -> false
        }

    val bannerNeedsAction: Boolean
        get() = phase == SyncPhase.NeedsFolderAccess || phase == SyncPhase.Locked || phase == SyncPhase.Reset

    val showsBanner: Boolean
        get() = bannerNeedsAction || phase is SyncPhase.Stalled || phase == SyncPhase.Offline
}

enum class SyncDeviceIcon {
    PHONE,
    LAPTOP,
    DESKTOP,
    STUDIO,
    MINI,
    ;

    companion object {
        fun of(kind: String, deviceName: String): SyncDeviceIcon {
            if (kind == SyncedDevice.PHONE) return PHONE
            val lower = deviceName.lowercase()
            return when {
                "macbook" in lower -> LAPTOP
                "imac" in lower -> DESKTOP
                "studio" in lower -> STUDIO
                "mini" in lower -> MINI
                else -> DESKTOP
            }
        }
    }
}

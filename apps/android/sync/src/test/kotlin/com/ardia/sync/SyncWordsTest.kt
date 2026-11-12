package com.ardia.sync

import com.ardia.sync.core.RecoveryPhrase
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncWordsTest {
    private val now = 1_800_000_000_000L

    @Test
    fun waitingTextCountsFiles() {
        assertEquals("Waiting for 1 file to download", SyncStatusText.waitingForDownloads(1))
        assertEquals("Waiting for 3 files to download", SyncStatusText.waitingForDownloads(3))
    }

    @Test
    fun everyPhaseHasTheIPhonesWords() {
        val cases = listOf(
            SyncPhase.Off to "Off",
            SyncPhase.Starting to "Starting up",
            SyncPhase.Updating to "Updating · Waiting for 2 files to download",
            SyncPhase.Updated to "Updated just now · Waiting for 2 files to download",
            SyncPhase.Stalled("x") to "Not syncing · Last synced 5 minutes ago",
            SyncPhase.Offline to "Offline",
            SyncPhase.NeedsFolderAccess to "Choose your sync folder again to keep syncing.",
            SyncPhase.Locked to "Enter your recovery phrase to keep syncing on this phone.",
            SyncPhase.Reset to "This device is out of sync. Sync may have been reset from another device.",
        )
        for ((phase, words) in cases) assertEquals(words, SyncStatusText.of(phase, now - 300_000, 2, now))
        assertEquals("Not syncing", SyncStatusText.of(SyncPhase.Stalled("x"), null, 0, now))
        assertEquals("Updated just now", SyncStatusText.of(SyncPhase.Updated, now, 0, now))
    }

    @Test
    fun relativeTimeUsesTheLargestWholeUnit() {
        val cases = listOf(
            1_000L to "1 second ago",
            59_000L to "59 seconds ago",
            60_000L to "1 minute ago",
            90 * 60_000L to "1 hour ago",
            36 * 3_600_000L to "1 day ago",
            10 * 86_400_000L to "1 week ago",
            45 * 86_400_000L to "1 month ago",
            800 * 86_400_000L to "2 years ago",
        )
        for ((age, words) in cases) assertEquals(words, RelativeTime.ago(now - age, now))
    }

    @Test
    fun statusWordsPickTheAttentionAndTheRowsWords() {
        fun words(phase: SyncPhase, enabled: Boolean = true) = SyncStatusWords(phase, SyncStatusText.of(phase, now - 60_000, 0, now), enabled)
        assertEquals("Every tab, anywhere.", words(SyncPhase.Off, enabled = false).rowSubtitle.text)
        assertEquals("Your Mac’s tabs here, and this phone’s on your Mac.", words(SyncPhase.Off, enabled = false).heroSubtitle.text)
        assertEquals(SyncStatusLine("Choose Your Sync Folder Again", true), words(SyncPhase.NeedsFolderAccess).rowSubtitle)
        assertEquals(SyncStatusLine("Enter Your Recovery Phrase", true), words(SyncPhase.Locked).rowSubtitle)
        assertEquals(SyncStatusLine("Out of Sync", true), words(SyncPhase.Reset, enabled = false).rowSubtitle)
        assertEquals(SyncStatusLine("Not syncing · Last synced 1 minute ago", true), words(SyncPhase.Stalled("x")).rowSubtitle)
        assertEquals(SyncStatusLine("Updated just now", false), words(SyncPhase.Updated).rowSubtitle)
        assertEquals(SyncStatusLine("Offline", false), words(SyncPhase.Offline).heroSubtitle)
        assertEquals(SyncStatusLine("Choose your sync folder again to keep syncing.", true), words(SyncPhase.NeedsFolderAccess).heroSubtitle)
        assertEquals(SyncStatusWords.Attention.STALLED, words(SyncPhase.Stalled("x")).attention)
        assertEquals("Sync With Mac", words(SyncPhase.Updated).rowTitle)
    }

    @Test
    fun connectedMeansEnabledAndNotLockedOffOrReset() {
        val connected = listOf(SyncPhase.Starting, SyncPhase.Updating, SyncPhase.Updated, SyncPhase.Stalled("x"), SyncPhase.Offline, SyncPhase.NeedsFolderAccess)
        for (phase in connected) {
            assertTrue(SyncStatusWords(phase, "", true).isConnected)
            assertFalse(SyncStatusWords(phase, "", false).isConnected)
        }
        for (phase in listOf(SyncPhase.Off, SyncPhase.Locked, SyncPhase.Reset)) assertFalse(SyncStatusWords(phase, "", true).isConnected)
        assertTrue(SyncStatusWords(SyncPhase.Locked, "", true).bannerNeedsAction)
        assertTrue(SyncStatusWords(SyncPhase.Offline, "", true).showsBanner)
        assertFalse(SyncStatusWords(SyncPhase.Offline, "", true).bannerNeedsAction)
        assertFalse(SyncStatusWords(SyncPhase.Updated, "", true).showsBanner)
    }

    @Test
    fun deviceIconsFollowTheMacsName() {
        assertEquals(SyncDeviceIcon.LAPTOP, SyncDeviceIcon.of(SyncedDevice.MAC, "Shivam’s MacBook Air"))
        assertEquals(SyncDeviceIcon.STUDIO, SyncDeviceIcon.of(SyncedDevice.MAC, "Mac Studio"))
        assertEquals(SyncDeviceIcon.MINI, SyncDeviceIcon.of(SyncedDevice.MAC, "Mac mini"))
        assertEquals(SyncDeviceIcon.DESKTOP, SyncDeviceIcon.of(SyncedDevice.MAC, "iMac"))
        assertEquals(SyncDeviceIcon.DESKTOP, SyncDeviceIcon.of(SyncedDevice.MAC, "Office"))
        assertEquals(SyncDeviceIcon.PHONE, SyncDeviceIcon.of(SyncedDevice.PHONE, "MacBook"))
    }

    @Test
    fun theScannedCodeIsAcceptedOnlyWhenItIsAValidPhrase() {
        val words = RecoveryPhrase.words(RecoveryPhrase.generateEntropy())
        val phrase = words.joinToString(" ")
        assertEquals(phrase, SyncJoin.phraseFromCode("  $phrase\n"))
        val kit = words.withIndex().joinToString("\n") { "${it.index + 1}. ${it.value.uppercase()}" }
        assertEquals(kit, SyncJoin.phraseFromCode(kit))
        assertNull(SyncJoin.phraseFromCode("https://ardia.dev/"))
        assertNull(SyncJoin.phraseFromCode(words.dropLast(1).joinToString(" ")))
        assertNull(SyncJoin.phraseFromCode(""))
        val swapped = words.toMutableList().apply { add(0, removeAt(1)) }
        if (runCatching { RecoveryPhrase.entropy(swapped.joinToString(" ")) }.isFailure) assertNull(SyncJoin.phraseFromCode(swapped.joinToString(" ")))
    }

    @Test
    fun typedWordsGetACounterAndTheIPhonesProblems() {
        val words = RecoveryPhrase.words(RecoveryPhrase.generateEntropy())
        assertEquals(PhraseCheck(0, "0/24 words", false, null, false), SyncJoin.check(""))
        assertEquals("3/24 words", SyncJoin.check("abandon, ability able").counterText)
        val tooMany = SyncJoin.check((words + "abandon").joinToString(" "))
        assertTrue(tooMany.isTooLong)
        assertEquals("too many words", tooMany.counterText)
        assertNull(tooMany.problem)
        val unknown = SyncJoin.check((words.dropLast(1) + "zzzzzz").joinToString(" "))
        assertEquals("“zzzzzz” is not a valid recovery phrase word.", unknown.problem)
        assertEquals(PhraseFooter("“zzzzzz” is not a valid recovery phrase word.", PhraseFooter.Tone.PROBLEM), SyncJoin.footer(unknown))
        val good = SyncJoin.check(words.joinToString(" "))
        assertTrue(good.isValid)
        assertEquals(PhraseFooter("All 24 words check out.", PhraseFooter.Tone.GOOD), SyncJoin.footer(good))
        assertEquals(PhraseFooter(SyncJoin.MAC_HINT, PhraseFooter.Tone.HINT), SyncJoin.footer(SyncJoin.check("abandon")))
        val abbreviated = SyncJoin.check(words.joinToString(" ") { it.take(4) })
        assertTrue(abbreviated.isValid)
    }

    @Test
    fun everyConnectFailureHasWordsAndConnectedHasNone() {
        assertNull(ConnectResult.Connected.message)
        for (result in listOf(ConnectResult.Mismatch, ConnectResult.NoSyncData, ConnectResult.FolderUnavailable, ConnectResult.KeyStoreFailed, ConnectResult.Busy)) {
            assertTrue(result.message!!.isNotBlank())
            assertFalse(result.message!!.contains("\u2014"))
        }
        assertEquals("Recovery phrase must be exactly 24 words.", ConnectResult.InvalidPhrase("Recovery phrase must be exactly 24 words.").message)
    }

    @Test
    fun theDemoHasTwoMacsTwoSpacesAndOnlyTheMacBookTakesTabs() {
        val demo = SyncDemo.snapshot(now)
        assertEquals(listOf("MacBook Pro", "Mac Studio"), demo.devices.filterNot { it.isCurrent }.map { it.name })
        assertEquals(SyncedDevice.PHONE, demo.devices.single { it.isCurrent }.kind)
        assertEquals(listOf("Personal", "Work"), demo.profiles.map { it.name })
        assertEquals("Personal", demo.defaultProfile?.name)
        assertEquals(listOf("MacBook Pro"), demo.devicesThatReceiveTabs(null).map { it.name })
        assertEquals(listOf("MacBook Pro"), demo.devicesThatReceiveTabs("demo-work").map { it.name })
        val personal = demo.profile("demo-personal")!!
        assertEquals(listOf(12, 2), personal.deviceTabs.map { it.tabs.size })
        assertEquals(listOf("Mail", "Calendar", "Social", "Music"), personal.pinned.tiles.map { it.title })
        assertEquals(listOf("t:demo-notes", "g:demo-trip", "t:demo-docs"), personal.pinned.sections.map { it.id })
        assertEquals("Food", personal.pinned.sections[1].group!!.items[2].group!!.name)
        assertEquals(listOf("Apple", "Reading", "Weather"), personal.bookmarks.map { it.title })
        assertTrue(personal.bookmarks[1].isFolder)
        assertEquals(5, personal.history.size)
        assertEquals(listOf("plum", "green"), demo.profiles.map { it.color })
        assertEquals("#4F7CFF", demo.profile("demo-work")!!.theme!!.colors.first())
        assertEquals(listOf("#1E2A5A", "#3A2466"), demo.profile("demo-work")!!.theme!!.darkColors)
        assertEquals(listOf("MacBook Pro", "Mac Studio", "Android"), demo.devicesInOrder.map { it.name })
        assertEquals(demo, syncJson.decodeFromString(SyncSnapshot.serializer(), syncJson.encodeToString(demo)))
    }

    @Test
    fun theFolderLocationSurvivesTheMetaFile() {
        val meta = SyncMeta(deviceId = "d", folder = SyncFolderLocation.Tree("content://com.example/tree/1", "Ardia Sync", "Ardia Sync"), enabled = true)
        val text = syncJson.encodeToString(meta)
        assertEquals(meta, syncJson.decodeFromString(SyncMeta.serializer(), text))
        val local = meta.copy(folder = SyncFolderLocation.Path("/data/sync", "sync"))
        assertEquals(local, syncJson.decodeFromString(SyncMeta.serializer(), syncJson.encodeToString(local)))
    }
}

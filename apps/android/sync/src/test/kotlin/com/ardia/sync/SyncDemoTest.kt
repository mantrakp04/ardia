package com.ardia.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncDemoTest {
    private val now = 1_800_000_000_000L

    @Test
    fun stoppingTheDemoTurnsItOffAndConnectingTurnsItBackOn() {
        val demo = DemoSyncDevice(now)
        demo.stopSyncing()
        assertFalse(demo.isEnabled)
        assertEquals(SyncPhase.Off, demo.phase)
        assertTrue(demo.snapshot.profiles.isEmpty())
        assertEquals(null, demo.folderName)
        assertEquals(ConnectResult.Connected, demo.connect("any phrase", SyncFolderPick.Tree("content://demo")))
        assertTrue(demo.isEnabled)
        assertEquals(SyncPhase.Updated, demo.phase)
        assertTrue(demo.snapshot.profiles.isNotEmpty())
        assertTrue(DemoSyncDevice(now).isEnabled)
    }

    @Test
    fun aRenamedDemoPhoneShowsItsNewNameInTheDevicesList() {
        val demo = DemoSyncDevice(now)
        demo.deviceName = "Lab Phone"
        assertEquals("Lab Phone", demo.snapshot.devices.single { it.isCurrent }.name)
    }

    @Test
    fun aPinFromTheDemoShowsInThatProfilesBookmarksOnce() {
        val demo = DemoSyncDevice(now)
        val profile = demo.snapshot.defaultProfile!!.syncId
        assertTrue(demo.addBookmark("https://pinned.example/", "Pinned", profile, fromPrivateTab = false))
        assertTrue(demo.addBookmark("https://pinned.example/", "Pinned", profile, fromPrivateTab = false))
        val urls = demo.snapshot.profile(profile)!!.bookmarks.flatMap { listOf(it) + it.children.orEmpty() }.mapNotNull { it.url }
        assertEquals(1, urls.count { it == "https://pinned.example/" })
        assertFalse(demo.addBookmark("https://private.example/", "Private", profile, fromPrivateTab = true))
    }
}

package com.ardia.browser.android

import com.ardia.browser.android.system.MacTabsWidget
import com.ardia.browser.android.system.SystemDevice
import com.ardia.browser.android.system.SystemDeviceTabs
import com.ardia.browser.android.system.SystemSnapshot
import com.ardia.browser.android.system.SystemSnapshots
import com.ardia.browser.android.system.SystemStore
import com.ardia.browser.android.system.SystemTab
import com.ardia.sync.DeviceTabs
import com.ardia.sync.RemoteTab
import com.ardia.sync.SyncSnapshot
import com.ardia.sync.SyncState
import com.ardia.sync.SyncedDevice
import com.ardia.sync.SyncedProfile
import com.ardia.sync.SyncedTheme
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SystemSnapshotTest {
    private val sample = SystemSnapshot(
        isSyncEnabled = true,
        macTabs = listOf(
            SystemDeviceTabs(
                SystemDevice("mac-1", "Luke’s MacBook Pro", SystemDevice.MAC),
                listOf(SystemTab("Swift.org", "https://www.swift.org/", "a.png"), SystemTab("", "https://news.ycombinator.com/")),
            ),
        ),
        sendTargets = listOf(SystemDevice("mac-1", "Luke’s MacBook Pro", SystemDevice.MAC)),
        gradient = listOf("#112233", "#445566"),
        darkGradient = listOf("#000000"),
        color = "blue",
    )

    @Test
    fun aSnapshotSurvivesTheFileTheWidgetsRead() {
        assertEquals(sample, SystemSnapshot.fromJson(sample.toJson()))
    }

    @Test
    fun anotherVersionOrDamagedFileReadsAsEmpty() {
        assertNull(SystemSnapshot.fromJson(sample.toJson().replace("\"version\":1", "\"version\":2")))
        assertNull(SystemSnapshot.fromJson("{not json"))
        val store = SystemStore(Files.createTempDirectory("system").toFile())
        assertEquals(SystemSnapshot.empty, store.loadSnapshot())
    }

    @Test
    fun savingKeepsOnlyTheFaviconsTheSnapshotNames() {
        val store = SystemStore(Files.createTempDirectory("system").toFile())
        assertTrue(store.saveFavicon(byteArrayOf(1), "a.png"))
        assertTrue(store.saveFavicon(byteArrayOf(2), "stale.png"))
        assertTrue(store.save(sample))
        assertTrue(store.hasFavicon("a.png"))
        assertFalse(store.hasFavicon("stale.png"))
        assertEquals(sample, store.loadSnapshot())
        assertFalse(File(store.directory, "snapshot.json.tmp").exists())
    }

    @Test
    fun faviconNamesMatchTheIphonesHash() {
        assertEquals("576846634e2714c6.png", SystemStore.faviconName("example.com"))
        assertEquals("9d1207f2d544fd88.png", SystemStore.faviconName("Swift.org"))
    }

    @Test
    fun tabTitlesFallBackToTheHost() {
        assertEquals("news.ycombinator.com", SystemTab("  ", "https://news.ycombinator.com/").displayTitle)
        assertEquals("swift.org", SystemTab("", "https://www.swift.org/").host)
    }

    @Test
    fun syncOffExportsOnlyTheColor() {
        val snapshot = SystemSnapshots.of(SyncState(isEnabled = false), SyncSnapshot.empty, null, "green")
        assertEquals(SystemSnapshot(isSyncEnabled = false, color = "green"), snapshot)
    }

    @Test
    fun syncOnExportsOtherMacsTabsNewestFirstAndTheSendTargets() {
        val devices = listOf(
            SyncedDevice("old-mac", "Mac Studio", SyncedDevice.MAC, lastSeen = 10.0, isCurrent = false, canReceiveTabs = false),
            SyncedDevice("new-mac", "MacBook Pro", SyncedDevice.MAC, lastSeen = 20.0, isCurrent = false, canReceiveTabs = true),
            SyncedDevice("me", "Pixel", SyncedDevice.PHONE, lastSeen = 30.0, isCurrent = true, canReceiveTabs = true),
        )
        val profile = SyncedProfile(
            syncId = "p1",
            name = "Personal",
            color = "purple",
            isDefault = true,
            theme = SyncedTheme(listOf("#AA0000", "#00AA00")),
            deviceTabs = listOf(
                DeviceTabs("old-mac", "Mac Studio", SyncedDevice.MAC, listOf(RemoteTab("https://a.example/", "A"))),
                DeviceTabs("new-mac", "MacBook Pro", SyncedDevice.MAC, (1..10).map { RemoteTab("https://b.example/$it", "B$it") } + RemoteTab("about:blank", "Blank")),
                DeviceTabs("me", "Pixel", SyncedDevice.PHONE, listOf(RemoteTab("https://c.example/", "C"))),
            ),
            sendTargets = listOf("new-mac", "old-mac", "me"),
        )
        val snapshot = SystemSnapshots.of(SyncState(isEnabled = true), SyncSnapshot(devices, listOf(profile)), null, null)
        assertEquals(listOf("new-mac", "old-mac"), snapshot.macTabs.map { it.device.id })
        assertEquals(SystemSnapshot.TAB_LIMIT_PER_DEVICE, snapshot.macTabs.first().tabs.size)
        assertTrue(snapshot.macTabs.first().tabs.all { it.url.startsWith("https://b.example/") })
        assertEquals(SystemStore.faviconName("b.example"), snapshot.macTabs.first().tabs.first().favicon)
        assertEquals(listOf("new-mac"), snapshot.sendTargets.map { it.id })
        assertEquals(listOf("#AA0000", "#00AA00"), snapshot.gradient)
        assertEquals("purple", snapshot.color)
        val picked = SystemSnapshots.of(SyncState(isEnabled = true), SyncSnapshot(devices, listOf(profile)), null, "red")
        assertTrue(picked.gradient.isEmpty())
        assertEquals("red", picked.color)
    }

    @Test
    fun theMediumWidgetShowsOneMacAndTheLargeOneSeveral() {
        val mac = { id: String, count: Int -> SystemDeviceTabs(SystemDevice(id, id, SystemDevice.MAC), (1..count).map { SystemTab("$it", "https://$id.example/$it") }) }
        val snapshot = SystemSnapshot(isSyncEnabled = true, macTabs = listOf(mac("one", 5), mac("empty", 0), mac("two", 5)))
        val medium = MacTabsWidget.sections(snapshot, MacTabsWidget.MEDIUM_ROWS, large = false)
        assertEquals(listOf("one"), medium.map { it.device.id })
        assertEquals(3, medium.single().tabs.size)
        val large = MacTabsWidget.sections(snapshot, MacTabsWidget.LARGE_ROWS, large = true)
        assertEquals(listOf("one", "two"), large.map { it.device.id })
        assertEquals(listOf(5, 1), large.map { it.tabs.size })
    }
}

package com.ardia.settings

import android.content.res.Resources
import androidx.test.core.app.ApplicationProvider
import com.ardia.blocking.BlockingCategory
import com.ardia.blocking.FilterListGroup
import com.ardia.blocking.FilterListInfo
import com.ardia.blocking.FilterListState
import com.ardia.blocking.MyFiltersResult
import com.ardia.store.ClearRange
import com.ardia.sync.SyncedDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en-rUS")
class SettingsWordsTest {
    private val resources: Resources = ApplicationProvider.getApplicationContext<android.content.Context>().resources
    private val now = 1_800_000_000_000L

    private fun list(state: FilterListState = FilterListState.Ready, enabled: Boolean = true, updatedAt: Long? = now - 3 * 3_600_000L, rules: Int = 9460) = FilterListInfo(
        id = "easylist", title = "EasyList", group = FilterListGroup.ADS, category = BlockingCategory.entries.first(),
        sourceUrl = "https://easylist.to/easylist.txt", supportUrl = null, languages = emptyList(), isEnabled = enabled, isDefault = true,
        isCustom = false, ruleCount = rules, skippedCount = 0, updatedAt = updatedAt, state = state,
    )

    @Test
    fun clearingNeedsAChoiceAndArchivedTabsOnlyCountForAllTime() {
        val none = ClearDataWords.choice(history = false, cache = false, cookies = false, archive = true, range = ClearRange.TODAY)
        assertTrue(none.isEmpty)
        assertEquals("Choose what to clear.", ClearDataWords.footer(resources, none))
        val archiveOnly = ClearDataWords.choice(history = false, cache = false, cookies = false, archive = true, range = ClearRange.ALL_TIME)
        assertFalse(archiveOnly.isEmpty)
    }

    @Test
    fun clearingWordsNameWhatGoesAndWhetherYouStaySignedIn() {
        val choice = ClearDataWords.choice(history = true, cache = true, cookies = true, archive = false, range = ClearRange.TODAY)
        assertEquals("Clear History, Cache, and Cookies from today?", ClearDataWords.confirmationTitle(resources, choice, ClearRange.TODAY))
        assertEquals("You’ll be signed out of websites. Open tabs stay open.", ClearDataWords.confirmationMessage(resources, choice))
        assertEquals(
            "History clears from this phone. Your Mac’s history stays on your Mac. Clearing cookies signs you out of websites.",
            ClearDataWords.footer(resources, choice),
        )
        val cacheOnly = ClearDataWords.choice(history = false, cache = true, cookies = false, archive = false, range = ClearRange.LAST_HOUR)
        assertEquals("Clear Cache from the last hour?", ClearDataWords.confirmationTitle(resources, cacheOnly, ClearRange.LAST_HOUR))
        assertEquals("You’ll stay signed in to websites.", ClearDataWords.footer(resources, cacheOnly))
    }

    @Test
    fun ruleAndListCountsAreInflectedAndGrouped() {
        assertEquals("1 rule", FilterListWords.rules(resources, 1))
        assertEquals("9,460 rules", FilterListWords.rules(resources, 9460))
        assertEquals("3 lists · 12,000 rules", FilterListWords.summary(resources, 3, 12000))
    }

    @Test
    fun updatedWordsSayJustNowNeverOrHowLongAgo() {
        assertEquals("Not updated yet", FilterListWords.updated(resources, null, now))
        assertEquals("Updated just now", FilterListWords.updated(resources, now - 10_000, now))
        assertEquals("Updated 3 hours ago", FilterListWords.updated(resources, now - 3 * 3_600_000L, now))
        assertEquals("Updating…", FilterListWords.status(resources, isUpdating = true, isOffline = true, lastUpdated = null, now = now))
        assertEquals("Offline · Not updated yet", FilterListWords.status(resources, isUpdating = false, isOffline = true, lastUpdated = null, now = now))
    }

    @Test
    fun listFactsFollowTheListsState() {
        assertEquals(FilterListFacts("9,460 rules · Updated 3 hours ago", false), FilterListWords.facts(resources, list(), now))
        assertEquals(FilterListFacts("Downloads when you turn it on", false), FilterListWords.facts(resources, list(enabled = false, updatedAt = null), now))
        assertEquals(FilterListFacts("Couldn’t update", true), FilterListWords.facts(resources, list(state = FilterListState.Failed("down")), now))
        assertEquals(FilterListFacts("9,460 rules · Waiting for a connection", false), FilterListWords.facts(resources, list(state = FilterListState.Offline), now))
        assertEquals("Off", FilterListWords.detailStatus(resources, list(enabled = false)))
        assertEquals("Couldn’t Update", FilterListWords.detailStatus(resources, list(state = FilterListState.Failed("down"))))
    }

    @Test
    fun resetAndMyFiltersWordsCountWhatChanges() {
        assertEquals("uBlock Origin’s default lists turn back on and the rest turn off.", FilterListWords.resetMessage(resources, 0))
        assertEquals(
            "uBlock Origin’s default lists turn back on, the rest turn off, and 2 lists you added will be removed.",
            FilterListWords.resetMessage(resources, 2),
        )
        assertEquals("None", FilterListWords.myFiltersCount(resources, MyFiltersResult(0, 0)))
        assertEquals("No rules yet", FilterListWords.myFiltersSummary(resources, MyFiltersResult(0, 0), hasChanges = false))
        assertEquals("4 rules · 1 skipped", FilterListWords.myFiltersSummary(resources, MyFiltersResult(4, 1), hasChanges = false))
        assertEquals("Changes aren’t applied yet", FilterListWords.myFiltersSummary(resources, MyFiltersResult(4, 1), hasChanges = true))
    }

    @Test
    fun deviceLastSeenNamesThisPhoneAndRecentSyncs() {
        val phone = SyncedDevice("p", "Pixel", SyncedDevice.PHONE, now.toDouble(), isCurrent = true, canReceiveTabs = false)
        val never = SyncedDevice("n", "Mac mini", SyncedDevice.MAC, null, isCurrent = false, canReceiveTabs = true)
        val fresh = SyncedDevice("f", "MacBook Pro", SyncedDevice.MAC, (now - 5_000).toDouble(), isCurrent = false, canReceiveTabs = true)
        assertEquals("This Phone", SyncDeviceWords.lastSeen(resources, phone, now))
        assertEquals("Not Yet Synced", SyncDeviceWords.lastSeen(resources, never, now))
        assertEquals("Just Now", SyncDeviceWords.lastSeen(resources, fresh, now))
    }
}

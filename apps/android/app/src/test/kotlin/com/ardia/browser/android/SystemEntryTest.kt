package com.ardia.browser.android

import android.app.SearchManager
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.ardia.appmodel.LaunchArguments
import com.ardia.appmodel.SystemLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SystemEntryTest {
    private val context get() = ApplicationProvider.getApplicationContext<ArdiaApplication>()

    @Test
    fun aWebLinkFromAnotherAppOpensAsALink() {
        val entry = SystemEntry.from(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.swift.org/blog/")))
        assertEquals(SystemEntry.Link("https://www.swift.org/blog/"), entry)
    }

    @Test
    fun anArdiaLinkReachesTheModelUnchanged() {
        val entry = SystemEntry.from(Intent(Intent.ACTION_VIEW, Uri.parse(SystemLink.Incognito.uri)))
        assertEquals(SystemEntry.Link("ardia://incognito"), entry)
    }

    @Test
    fun otherSchemesAreRefused() {
        assertNull(SystemEntry.from(Intent(Intent.ACTION_VIEW, Uri.parse("javascript:alert(1)"))))
        assertNull(SystemEntry.from(Intent(Intent.ACTION_VIEW, Uri.parse("file:///sdcard/a.html"))))
        assertNull(SystemEntry.from(Intent(Intent.ACTION_SEND)))
    }

    @Test
    fun aWebSearchSearchesAndAnEmptyOneOpensTheSearchField() {
        val search = Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, "  tapas lisbon ")
        assertEquals(SystemEntry.Search("tapas lisbon"), SystemEntry.from(search))
        assertEquals(SystemEntry.Link(SystemLink.Search(null).uri), SystemEntry.from(Intent(Intent.ACTION_WEB_SEARCH)))
    }

    @Test
    fun selectedTextSearchesUnlessItIsOneWebAddress() {
        val words = Intent(Intent.ACTION_PROCESS_TEXT).putExtra(Intent.EXTRA_PROCESS_TEXT, "best tapas")
        assertEquals(SystemEntry.Search("best tapas"), SystemEntry.from(words))
        val address = Intent(Intent.ACTION_PROCESS_TEXT).putExtra(Intent.EXTRA_PROCESS_TEXT, " https://example.com/a ")
        assertEquals(SystemEntry.Link("https://example.com/a"), SystemEntry.from(address))
        assertNull(SystemEntry.from(Intent(Intent.ACTION_PROCESS_TEXT).putExtra(Intent.EXTRA_PROCESS_TEXT, "   ")))
    }

    @Test
    fun theShortcutAndTileIntentsCarryTheirLinksToMainActivity() {
        val intent = SystemIntents.main(context, SystemLink.VoiceSearch)
        assertEquals(MainActivity::class.java.name, intent.component?.className)
        assertEquals(SystemEntry.Link("ardia://voice"), SystemEntry.from(intent))
    }

    @Test
    fun launchArgumentsAreReadInADebuggableBuild() {
        val intent = Intent().putExtra(LaunchArguments.ARDIA_DEMO, true).putExtra(LaunchArguments.ARDIA_RESTING_START, "YES")
        val launch = SystemIntents.launchArguments(context, intent)
        assertEquals(context.acceptsLaunchArguments, launch.isDemo)
        assertEquals(context.acceptsLaunchArguments, launch.restingStart)
    }
}

package com.ardia.browser.android

import com.ardia.browser.android.share.ShareSheetModel
import com.ardia.browser.android.share.SharedPage
import com.ardia.browser.android.system.SystemDevice
import com.ardia.browser.android.system.SystemSnapshot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@OptIn(ExperimentalCoroutinesApi::class)
class ShareSheetTest {
    private val mac = SystemDevice("mac-1", "MacBook Pro", SystemDevice.MAC)
    private val synced = SystemSnapshot(isSyncEnabled = true, sendTargets = listOf(mac))

    @Test
    fun aSharedLinkKeepsItsSubjectAsTheTitle() {
        val page = SharedPage.from("https://en.wikipedia.org/wiki/Lisbon", "Lisbon - Wikipedia")
        assertEquals("https://en.wikipedia.org/wiki/Lisbon", page.url)
        assertEquals("Lisbon - Wikipedia", page.displayTitle)
        assertEquals("en.wikipedia.org", page.host)
    }

    @Test
    fun aLinkInsideTextIsFoundAndTheTextBecomesTheTitle() {
        val page = SharedPage.from("Look at this: https://www.swift.org/blog/.", null)
        assertEquals("https://www.swift.org/blog/", page.url)
        assertEquals("Look at this: https://www.swift.org/blog/.", page.title)
    }

    @Test
    fun aBareLinkHasNoTitleAndFallsBackToItsHost() {
        val page = SharedPage.from("https://www.swift.org/", "https://www.swift.org/")
        assertEquals("", page.title)
        assertEquals("swift.org", page.displayTitle)
    }

    @Test
    fun plainTextSearchesAndOffersNoSending() {
        val opened = ArrayList<String>()
        val model = model(SharedPage.from("best tapas in lisbon", null), synced, opened)
        assertFalse(model.opensPage)
        assertTrue(model.sendTargets.isEmpty())
        model.openInArdia()
        assertEquals(listOf("ardia://search?q=best%20tapas%20in%20lisbon"), opened)
    }

    @Test
    fun aPageOpensThroughTheOpenLink() {
        val opened = ArrayList<String>()
        model(SharedPage.from("https://example.com/a?b=1", null), synced, opened).openInArdia()
        assertEquals("ardia://open?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1", opened.single())
    }

    @Test
    fun sendTargetsAppearOnlyWithSyncOnAndAPage() {
        val page = SharedPage.from("https://example.com", null)
        assertEquals(listOf(mac), model(page, synced).sendTargets)
        assertTrue(model(page, SystemSnapshot.empty).sendTargets.isEmpty())
        assertTrue(model(page, SystemSnapshot.empty).offersSyncHint)
        assertFalse(model(page, synced).offersSyncHint)
    }

    @Test
    fun nothingSharedHasNoContent() {
        val page = SharedPage.from("   ", null)
        assertNull(page.url)
        assertFalse(model(page, synced).hasContent)
    }

    @Test
    fun sendingConfirmsThenFinishes() {
        val scope = TestScope(StandardTestDispatcher())
        var finished = 0
        val model = ShareSheetModel(SharedPage.from("https://example.com", "Example"), synced, scope, { true }, { _, _ -> true }, { finished++ }, {})
        model.send(mac)
        assertEquals(ShareSheetModel.Phase.Sending(mac), model.phase)
        scope.runCurrent()
        assertEquals(ShareSheetModel.Phase.Done(ShareSheetModel.Message.Sent("MacBook Pro"), true), model.phase)
        assertEquals(1, model.completions)
        scope.advanceTimeBy(ShareSheetModel.CONFIRMATION_DELAY_MILLIS + 1)
        assertEquals(1, finished)
    }

    @Test
    fun aFailedSendSaysSoAndCountsAFailure() {
        val scope = TestScope(StandardTestDispatcher())
        val model = ShareSheetModel(SharedPage.from("https://example.com", null), synced, scope, { true }, { _, _ -> false }, {}, {})
        model.send(mac)
        scope.runCurrent()
        assertEquals(ShareSheetModel.Phase.Done(ShareSheetModel.Message.CouldNotSend("MacBook Pro"), false), model.phase)
        assertEquals(1, model.failures)
    }

    private fun model(page: SharedPage, snapshot: SystemSnapshot, opened: MutableList<String> = ArrayList()) =
        ShareSheetModel(page, snapshot, TestScope(), { opened.add(it); true }, { _, _ -> true }, {}, {})
}

package com.ardia.phone

import android.view.View
import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FrostPageTest {
    @After
    fun reset() {
        FrostSources.pageMode = FrostSources.PageMode.Live
    }

    private fun choose(holdsPage: Boolean, mode: FrostSources.PageMode = FrostSources.PageMode.Live, blur: Boolean = true, reduce: Boolean = false, inside: Boolean = false, content: Boolean = true) =
        FrostPage.choose(blur, reduce, hasSource = true, sourceHasContent = content, hardware = true, insideSource = inside, holdsPage = holdsPage, pageMode = mode)

    @Test
    fun aPageUnderTheFrostIsBlurredLiveAndRedrawnOrDrawnSolidWhenAsked() {
        assertEquals(FrostPage.Path.Live, choose(holdsPage = false).path)
        assertEquals("page under the frost, redrawn every frame", choose(holdsPage = true).reason)
        assertEquals(FrostPage.Path.Solid, choose(holdsPage = true, mode = FrostSources.PageMode.Solid).path)
        assertEquals(FrostPage.Path.Live, choose(holdsPage = false, mode = FrostSources.PageMode.Solid).path)
        assertEquals(FrostPage.Path.Fallback, choose(holdsPage = true, blur = false).path)
        assertEquals(FrostPage.Path.Fallback, choose(holdsPage = true, reduce = true).path)
        assertEquals(FrostPage.Path.Fallback, choose(holdsPage = false, inside = true).path)
        assertEquals(FrostPage.Path.Fallback, choose(holdsPage = false, content = false).path)
    }

    @Test
    fun aShownWebViewAnywhereInsideTheSourceCountsAsAPage() {
        val activity = Robolectric.buildActivity(android.app.Activity::class.java).setup().get()
        val root = FrameLayout(activity)
        val nested = FrameLayout(activity)
        val web = WebView(activity)
        nested.addView(web, FrameLayout.LayoutParams(300, 300))
        root.addView(nested)
        activity.setContentView(root)
        root.measure(View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 400, 400)
        assertTrue(FrostPage.holdsPage(root) { true })
        web.visibility = View.GONE
        assertFalse(FrostPage.holdsPage(root) { true })
        web.visibility = View.VISIBLE
        assertFalse(FrostPage.holdsPage(root) { false })
    }

    @Test
    fun theProbeReportsBrightnessAndHowMuchCameBackBlack() {
        val white = 0xFFFFFFFF.toInt()
        val black = 0xFF000000.toInt()
        assertEquals(FrostProbe.Reading(255, 0), FrostProbe.read(IntArray(10) { white }))
        assertEquals(FrostProbe.Reading(0, 100), FrostProbe.read(IntArray(10) { black }))
        assertEquals(50, FrostProbe.read(IntArray(10) { if (it < 5) white else black }).nearBlackShare)
    }
}

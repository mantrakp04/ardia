package com.ardia.browser

import android.graphics.Bitmap
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PageSnapshotTest {
    private val harness = PageHarness()
    private lateinit var page: Page

    @Before
    fun showThePage() {
        harness.server.page(
            "/top",
            "<title>Top</title><meta name=\"viewport\" content=\"width=device-width\">" +
                "<style>html,body{margin:0;background:#d01010;height:300%}#top{height:160px;background:#10a010;color:#10a010}</style>" +
                "<div id=\"top\">Headline</div>",
        )
        page = harness.open("tab", "/top")
        harness.show(page)
        harness.awaitTitle(page, "Top")
        harness.poll(intervalMillis = 250) { snapshot()?.takeIf(::showsTheTop) }
    }

    @After
    fun tearDown() = harness.close()

    @Test
    fun theParentsMoveScaleAndOverlayDoNotReachThePicture() {
        harness.withActivity { activity ->
            activity.container.translationY = activity.container.height * 0.5f
            activity.container.scaleX = 0.6f
            activity.container.scaleY = 0.6f
            activity.container.addView(
                View(activity).apply { setBackgroundColor(Color.WHITE) },
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, activity.container.height / 2),
            )
        }
        val picture = snapshot()
        assertNotNull(picture)
        assertShowsTheTop(picture!!)
        assertEquals(CaptureRoute.ViewDraw, onMain { (page as WebViewPage).lastCaptureRoute })
    }

    @Test
    fun aPageMostlyOffScreenIsStillPicturedWhole() {
        harness.withActivity { activity -> activity.container.translationX = activity.container.width * 0.8f }
        val picture = snapshot()
        assertNotNull(picture)
        assertShowsTheTop(picture!!)
        val offScreenTop = picture.getPixel(picture.width * 9 / 10, picture.height / 25)
        assertTrue("off-screen top: ${describe(offScreenTop)}", isGreen(offScreenTop))
    }

    @Test
    fun aSnapshotRightAfterANightModeChangeShowsThePage() {
        val wasNight = harness.shell("cmd uimode night").contains("yes")
        try {
            harness.shell("cmd uimode night ${if (wasNight) "no" else "yes"}")
            val immediate = snapshot()
            assertNotNull(immediate)
            assertShowsTheTop(immediate!!)
            Thread.sleep(500)
            val settled = snapshot()
            assertNotNull(settled)
            assertShowsTheTop(settled!!)
        } finally {
            harness.shell("cmd uimode night ${if (wasNight) "yes" else "no"}")
        }
    }

    private fun snapshot(): Bitmap? = harness.onMainSuspending { page.snapshot(300) }

    private fun showsTheTop(picture: Bitmap): Boolean =
        isGreen(picture.getPixel(picture.width / 2, picture.height / 25)) && isRed(picture.getPixel(picture.width / 2, picture.height * 3 / 5))

    private fun assertShowsTheTop(picture: Bitmap) {
        val top = picture.getPixel(picture.width / 2, picture.height / 25)
        val middle = picture.getPixel(picture.width / 2, picture.height * 3 / 5)
        assertTrue("top ${describe(top)}, middle ${describe(middle)}, size ${picture.width}x${picture.height}", isGreen(top) && isRed(middle))
    }

    private fun describe(color: Int): String = "#%08X".format(color)

    private fun isGreen(color: Int): Boolean = Color.green(color) > 130 && Color.red(color) < 60 && Color.blue(color) < 60

    private fun isRed(color: Int): Boolean = Color.red(color) > 180 && Color.green(color) < 60 && Color.blue(color) < 60
}

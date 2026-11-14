package com.ardia.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DesktopFitTest {
    @Test
    fun aDesktopPageAtOneToOneZoomsOutToTheViewsWidth() {
        val factor = DesktopFit.zoomFactor(viewWidthPixels = 1080, contentWidthCss = 1120.0, currentScale = 2.75f)!!
        assertEquals(1080 / 1120.0 / 2.75, factor.toDouble(), 1e-6)
    }

    @Test
    fun unknownZeroNegativeAndNotANumberInputsGiveNoZoom() {
        for (width in listOf(0, -1, Int.MIN_VALUE)) assertNull(DesktopFit.zoomFactor(width, 1120.0, 2.75f))
        for (content in listOf(0.0, -980.0, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) assertNull(DesktopFit.zoomFactor(1080, content, 2.75f))
        for (scale in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY)) assertNull(DesktopFit.zoomFactor(1080, 1120.0, scale))
    }

    @Test
    fun hugeInputsStayWithinWhatWebViewAccepts() {
        val tiny = DesktopFit.zoomFactor(1, Double.MAX_VALUE, Float.MAX_VALUE)
        assertTrue(tiny == null || tiny.toDouble() >= DesktopFit.SMALLEST_FACTOR)
        assertEquals(DesktopFit.SMALLEST_FACTOR, DesktopFit.zoomFactor(1, 1_000_000.0, 50f)!!.toDouble(), 1e-6)
        assertTrue(DesktopFit.SMALLEST_FACTOR.toFloat().toDouble() > 0.01)
        assertNull(DesktopFit.zoomFactor(Int.MAX_VALUE, 1.0, Float.MIN_VALUE))
    }

    @Test
    fun aPageThatAlreadyFitsOrIsNarrowerIsLeftAlone() {
        assertNull(DesktopFit.zoomFactor(1080, 1120.0, 1080 / 1120f))
        assertNull(DesktopFit.zoomFactor(1080, 1120.0, 0.97f * 1080 / 1120f))
        assertNull(DesktopFit.zoomFactor(1080, 300.0, 1f))
    }

    @Test
    fun theContentWidthComesOnlyFromAPositiveNumber() {
        assertEquals(1120.0, DesktopFit.contentWidth("1120")!!, 0.0)
        assertEquals(980.5, DesktopFit.contentWidth(" 980.5 ")!!, 0.0)
        for (raw in listOf(null, "", "null", "undefined", "0", "-3", "NaN", "Infinity", "\"1120\"")) assertNull(raw, DesktopFit.contentWidth(raw))
    }

    @Test
    fun eachDecisionSaysWhatItDidOrWhichGuardStoppedIt() {
        assertEquals("zoomBy(0.3506)", DesktopFit.decide(1080, 1120.0, 2.75f).toString())
        assertEquals("skipped: the view has no width", DesktopFit.decide(0, 1120.0, 2.75f).toString())
        assertEquals("skipped: no content width", DesktopFit.decide(1080, null, 2.75f).toString())
        assertEquals("skipped: no current scale", DesktopFit.decide(1080, 1120.0, Float.NaN).toString())
        assertEquals("skipped: already fits (factor 1.0000)", DesktopFit.decide(1080, 1120.0, 1080 / 1120f).toString())
        assertEquals("skipped: the content is narrower than the view (factor 3.6000)", DesktopFit.decide(1080, 300.0, 1f).toString())
    }
}

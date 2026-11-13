package com.ardia.design

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class TabsDeckGeometryTest {
    private val geometry = TabsDeckGeometry(DeckSize(393.0, 852.0), safeTop = 59.0, safeBottom = 34.0)

    private fun near(expected: Double, actual: Double, tolerance: Double = 1e-9) = assertEquals(expected, actual, tolerance)

    @Test
    fun `an iPhone 16 Pro deck has the numbers the Swift geometry computes`() {
        near(273.31363636363636, geometry.cardSize.width)
        near(592.5272727272727, geometry.cardSize.height)
        near(58.949999999999996, geometry.focusLeading)
        near(194.71363636363637, geometry.spacing)
        near(54.47741498649223, geometry.leftReach)
        near(437.5, geometry.cardCenterY)
        near(812.0, geometry.barCenterY)
        val expected = listOf(4.473785727261472, 6.0000015548565955, 13.594520377250092, 58.949999999999996, 253.66363636363636, 545.7340909090909)
        listOf(-3.0, -1.0, -0.5, 0.0, 1.0, 2.5).zip(expected).forEach { (relative, leading) -> near(leading, geometry.leading(relative)) }
        near(52.9499984451434, geometry.visibleWidth(-1.0, isLast = false))
        near(0.04162439627334891, geometry.visibleWidth(-3.0, isLast = false))
        near(1.4379084967320261, geometry.expandedScale)
        near(33.5, geometry.tabButtonCenter.x)
    }

    @Test
    fun `landscape and a small Android phone match Swift too`() {
        val landscape = TabsDeckGeometry(DeckSize(852.0, 393.0), safeTop = 0.0, safeBottom = 21.0)
        near(592.5272727272727, landscape.cardSize.width)
        near(422.1272727272727, landscape.spacing)
        near(70.17123201800922, landscape.leftReach)
        near(185.0, landscape.cardCenterY)
        near(57.62876900160697, landscape.leading(-3.0))
        val pixel = TabsDeckGeometry(DeckSize(360.0, 800.0), safeTop = 24.0, safeBottom = 0.0)
        near(250.36363636363635, pixel.cardSize.width)
        near(49.32640419919894, pixel.leftReach)
        near(401.0, pixel.cardCenterY)
        near(774.0, pixel.barCenterY)
        near(499.90909090909093, pixel.leading(2.5))
    }

    @Test
    fun `resting deck matches Arc's measured slots`() {
        val proMax = TabsDeckGeometry(DeckSize(440.0, 956.0), safeTop = 62.0, safeBottom = 34.0)
        assertTrue(abs(proMax.cardSize.width - 306) < 0.5)
        assertTrue(abs(proMax.leading(0.0) - 66) < 0.5)
        assertTrue(abs(proMax.leading(1.0) - 284) < 0.5)
        assertTrue(abs(geometry.leading(-1.0) - 6) < 0.5)
    }

    @Test
    fun `cards move without a jump as they cross the focus slot`() {
        val step = 0.001
        val leftSlope = (geometry.leading(0.0) - geometry.leading(-step)) / step
        val rightSlope = (geometry.leading(step) - geometry.leading(0.0)) / step
        assertTrue(abs(leftSlope - rightSlope) / rightSlope < 0.01)
        assertTrue(geometry.leading(1.0) < geometry.leading(0.0) + geometry.cardSize.width)
    }

    @Test
    fun `tucked cards stay on screen and keep their order`() {
        val positions = (0..16).map { geometry.leading(-8.0 + it * 0.5) }
        assertTrue(positions.all { it >= 0 })
        assertTrue(positions.zipWithNext().all { (a, b) -> a < b })
    }

    @Test
    fun `a mostly covered card shows only its favicon`() {
        assertTrue(geometry.visibleWidth(-1.0, isLast = false) < TabsDeckGeometry.HEADER_FAVICON_ONLY_WIDTH)
        assertTrue(abs(geometry.visibleWidth(0.0, isLast = false) - geometry.spacing) < 0.5)
        near(geometry.cardSize.width, geometry.visibleWidth(0.0, isLast = true))
    }

    @Test
    fun `a flick carries the deck past the nearest card`() {
        assertEquals(5, geometry.settleTarget(5.0, 0.0, 10))
        assertEquals(7, geometry.settleTarget(5.2, -2000.0, 10))
        assertEquals(0, geometry.settleTarget(0.2, 3000.0, 10))
        assertEquals(9, geometry.settleTarget(9.4, -4000.0, 10))
        assertEquals(0, geometry.settleTarget(3.0, 0.0, 0))
    }

    @Test
    fun `closing a card keeps the focused tab in the middle`() {
        assertEquals(4, TabsDeckGeometry.scrollAfterRemoving(2, 5, 9))
        assertEquals(5, TabsDeckGeometry.scrollAfterRemoving(5, 5, 9))
        assertEquals(8, TabsDeckGeometry.scrollAfterRemoving(9, 9, 9))
        assertEquals(0, TabsDeckGeometry.scrollAfterRemoving(0, 0, 0))
    }

    @Test
    fun `a card closes on a flick or a long drag, never on a drag down`() {
        val height = geometry.cardSize.height
        assertTrue(TabsDeckGeometry.shouldClose(-40.0, -900.0, height))
        assertTrue(TabsDeckGeometry.shouldClose(-height / 2, 0.0, height))
        assertFalse(TabsDeckGeometry.shouldClose(-60.0, -100.0, height))
        assertFalse(TabsDeckGeometry.shouldClose(120.0, 900.0, height))
    }

    @Test
    fun `only cards near the focus are built`() {
        assertEquals(24 until 36, TabsDeckGeometry.renderedRange(30.0, 60))
        assertEquals(0 until 3, TabsDeckGeometry.renderedRange(0.0, 3))
        assertTrue(TabsDeckGeometry.renderedRange(0.0, 0).isEmpty())
        assertEquals(0 until 7, TabsDeckGeometry.renderedRange(0.5, 60))
    }

    @Test
    fun `scrolling past either end resists like Swift`() {
        near(-0.35, TabsDeckGeometry.rubberBand(-1.0, 5))
        near(4.664700568815827, TabsDeckGeometry.rubberBand(6.5, 5))
        near(2.0, TabsDeckGeometry.rubberBand(2.0, 5))
    }

    @Test
    fun `landscape cards fit between the header and the bar`() {
        val landscape = TabsDeckGeometry(DeckSize(852.0, 393.0), safeTop = 0.0, safeBottom = 21.0)
        val top = landscape.cardCenterY - landscape.cardSize.height / 2
        val bottom = landscape.cardCenterY + landscape.cardSize.height / 2
        assertTrue(top >= TabsDeckGeometry.HEADER_HEIGHT)
        assertTrue(bottom < landscape.barCenterY - 20)
    }

    @Test
    fun `rounding goes half away from zero like Swift`() {
        assertEquals(1, 0.5.swiftRounded())
        assertEquals(-1, (-0.5).swiftRounded())
        assertEquals(2, 2.4999.swiftRounded())
    }
}

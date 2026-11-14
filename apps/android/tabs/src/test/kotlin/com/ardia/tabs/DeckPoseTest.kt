package com.ardia.tabs

import com.ardia.design.DeckSize
import com.ardia.design.TabsDeckGeometry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeckPoseTest {
    private val geometry = TabsDeckGeometry(DeckSize(393.0, 852.0), safeTop = 59.0, safeBottom = 34.0)
    private val order = listOf("a", "b", "c", "d")

    private fun pose(role: DeckRole, relative: Double = 0.0, scale: Double = 1.0, position: Double = 1.0, lift: Double = 0.0, vanish: Double = 0.0) =
        DeckPose().resolve(geometry, role, relative, scale, position, lift, vanish, isLast = false)

    @Test
    fun aSettledCardSitsWhereTheGeometryPutsIt() {
        val resolved = pose(DeckRole.Stay, relative = 1.0)
        val center = geometry.center(1.0)
        assertEquals(center.x, resolved.centerX, 1e-9)
        assertEquals(center.y, resolved.centerY, 1e-9)
        assertEquals(1.0, resolved.scale, 1e-9)
        assertEquals(DeckPose.CARD_RADIUS, resolved.corner, 1e-9)
        assertEquals(1.0, resolved.headerOpacity, 1e-9)
    }

    @Test
    fun theExpandedCardFillsTheScreenAtTheStartAndLandsInTheDeckAtTheEnd() {
        val start = pose(DeckRole.Expanded, scale = 0.0, position = 0.0)
        assertEquals(geometry.expandedScale, start.scale, 1e-9)
        assertEquals(geometry.expandedCenter.x, start.centerX, 1e-9)
        assertEquals(geometry.expandedCenter.y, start.centerY, 1e-9)
        assertEquals(DeckPose.DISPLAY_CORNER_RADIUS, start.corner, 1e-9)
        assertEquals(0.0, start.headerOpacity, 1e-9)
        val end = pose(DeckRole.Expanded)
        assertEquals(geometry.center(0.0).x, end.centerX, 1e-9)
        assertEquals(1.0, end.scale, 1e-9)
        assertEquals(DeckPose.CARD_RADIUS, end.corner, 1e-9)
    }

    @Test
    fun aVanishingCardShrinksAndFadesAndLosesItsHeader() {
        val gone = pose(DeckRole.Stay, vanish = 1.0)
        assertEquals(0.0, gone.opacity, 1e-9)
        assertEquals(0.72, gone.scale, 1e-9)
        assertEquals(0.0, gone.headerOpacity, 1e-9)
    }

    @Test
    fun liftingACardMovesItUpAndFadesItsHeaderByOneHundredTwentyPoints() {
        val lifted = pose(DeckRole.Stay, lift = -60.0)
        assertEquals(geometry.cardCenterY - 60, lifted.centerY, 1e-9)
        assertEquals(0.5, lifted.headerOpacity, 1e-9)
        assertEquals(0.0, pose(DeckRole.Stay, lift = -120.0).headerOpacity, 1e-9)
    }

    @Test
    fun sideCardsSlideOffScreenWhileATabOpens() {
        val left = pose(DeckRole.SlideLeft, position = 0.0)
        assertEquals(geometry.center(0.0).x - geometry.container.width * 0.7, left.centerX, 1e-9)
        val right = pose(DeckRole.SlideRight, position = 0.0)
        assertEquals(geometry.center(0.0).x + geometry.container.width, right.centerX, 1e-9)
    }

    @Test
    fun theLauncherRoleGrowsFromTheTabButton() {
        val start = pose(DeckRole.Launcher, scale = 0.0, position = 0.0)
        assertEquals(geometry.tabButtonCenter.x, start.centerX, 1e-9)
        assertEquals(DeckPose.LAUNCHER_START_WIDTH / geometry.cardSize.width, start.scale, 1e-9)
        assertEquals(0.0, start.opacity, 1e-9)
    }

    @Test
    fun rolesFollowThePhaseAndTheExpandedCard() {
        assertEquals(DeckRole.Stay, DeckPose.role(DeckPhase.Settled, "a", 0, order))
        val closing = DeckPhase.Closing("c")
        assertEquals(DeckRole.SlideLeft, DeckPose.role(closing, "a", 0, order))
        assertEquals(DeckRole.Expanded, DeckPose.role(closing, "c", 2, order))
        assertEquals(DeckRole.SlideRight, DeckPose.role(closing, "d", 3, order))
        val opening = DeckPhase.Opening("c")
        assertEquals(DeckRole.Launcher, DeckPose.role(opening, "b", 1, order))
        assertEquals(DeckRole.SlideRight, DeckPose.role(opening, "d", 3, order))
        assertEquals(DeckRole.Stay, DeckPose.role(DeckPhase.Opening(null), "b", 1, order))
        assertEquals(DeckRole.Stay, DeckPose.role(DeckPhase.Closing("gone"), "b", 1, order))
    }

    @Test
    fun theChromeAppearsOnlyInTheLastFortyPercentOfTheTransition() {
        val closing = DeckPhase.Closing("a")
        assertEquals(0.0, DeckPose.chromeOpacity(closing, 0.6), 1e-9)
        assertEquals(0.5, DeckPose.chromeOpacity(closing, 0.8), 1e-9)
        assertEquals(1.0, DeckPose.chromeOpacity(DeckPhase.Settled, 0.0), 1e-9)
        assertEquals(1.0, DeckPose.chromeOpacity(DeckPhase.Opening(null), 0.0), 1e-9)
        assertEquals(0.7, DeckPose.backdropOpacity(closing, 0.5), 1e-9)
    }

    @Test
    fun aTouchHitsTheTopmostCardUnderIt() {
        val count = 4
        val scroll = 2.0
        val relative = { index: Int -> index - scroll }
        val leadingOfThird = geometry.leading(1.0)
        val x = leadingOfThird + 4
        assertEquals(3, DeckHit.cardAt(geometry, count, 0 until count, x, geometry.cardCenterY, relative))
        val onlySecond = geometry.leading(0.0) + 2
        assertEquals(2, DeckHit.cardAt(geometry, count, 0 until count, onlySecond, geometry.cardCenterY, relative))
        assertNull(DeckHit.cardAt(geometry, count, 0 until count, x, geometry.cardCenterY + geometry.cardSize.height, relative))
        assertNull(DeckHit.cardAt(geometry, 0, IntRange.EMPTY, x, geometry.cardCenterY, relative))
    }
}

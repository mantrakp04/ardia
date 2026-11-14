package com.ardia.phone

import com.ardia.browsing.SwipeDirection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageDragDecisionTest {
    private fun decide(
        mode: SwipeMode = SwipeMode.Anywhere,
        pull: Boolean = true,
        dx: Float = 0f,
        dy: Float = 0f,
        startX: Float = 500f,
        canGoBack: Boolean = true,
        canGoForward: Boolean = true,
        canScrollLeft: Boolean = false,
        canScrollRight: Boolean = false,
        canScrollUp: Boolean = false,
        isLoading: Boolean = false,
    ) = PageDragDecision.decide(mode, pull, dx, dy, startX, 1080f, 72f, canGoBack, canGoForward, canScrollLeft, canScrollRight, canScrollUp, isLoading)

    @Test
    fun aSidewaysDragGoesBackOrForwardOnlyWhenThePageCannotScrollThatWay() {
        assertEquals(PageDragDecision.Decided(PageDragDecision.Drag.Swipe, SwipeDirection.Back), decide(dx = 60f, dy = 5f))
        assertEquals(PageDragDecision.Decided(PageDragDecision.Drag.Swipe, SwipeDirection.Forward), decide(dx = -60f, dy = 5f))
        assertNull(decide(dx = 60f, dy = 5f, canScrollLeft = true))
        assertNull(decide(dx = -60f, dy = 5f, canScrollRight = true))
        assertNull(decide(dx = 60f, dy = 5f, canGoBack = false))
        assertNull(decide(dx = 60f, dy = 50f))
    }

    @Test
    fun edgesModeTakesOnlyDragsThatStartAtAnEdgeAndOffTakesNone() {
        assertNull(decide(mode = SwipeMode.Edges, dx = 60f, startX = 500f))
        assertEquals(SwipeDirection.Back, decide(mode = SwipeMode.Edges, dx = 60f, startX = 20f)?.direction)
        assertEquals(SwipeDirection.Forward, decide(mode = SwipeMode.Edges, dx = -60f, startX = 1070f)?.direction)
        assertNull(decide(mode = SwipeMode.Off, dx = 60f))
        assertEquals(SwipeMode.Off, SwipeMode.of("unknown"))
        assertEquals(SwipeMode.Edges, SwipeMode.of("edges"))
    }

    @Test
    fun aDownwardDragRefreshesOnlyAtTheTopOfAPageThatIsNotLoading() {
        assertEquals(PageDragDecision.Decided(PageDragDecision.Drag.Pull, null), decide(dy = 40f, dx = 2f))
        assertNull(decide(dy = 40f, canScrollUp = true))
        assertNull(decide(dy = 40f, isLoading = true))
        assertNull(decide(dy = 40f, pull = false))
        assertNull(decide(dy = -40f))
        assertEquals(PageDragDecision.Drag.Pull, decide(mode = SwipeMode.Off, dy = 40f)?.drag)
    }

    @Test
    fun aSidewaysDragWaitsForThePageToSayItsContentTookItBeforeNavigating() {
        val density = 2.75f
        assertEquals(PageDragDecision.Settle.Wait, PageDragDecision.settle(contentClaimed = false, travelledPx = 5f * density, millisSinceSlop = 10L, density = density))
        assertEquals(PageDragDecision.Settle.Wait, PageDragDecision.settle(contentClaimed = false, travelledPx = 40f * density, millisSinceSlop = 20L, density = density))
        assertEquals(PageDragDecision.Settle.Wait, PageDragDecision.settle(contentClaimed = false, travelledPx = 2f * density, millisSinceSlop = 500L, density = density))
        assertEquals(PageDragDecision.Settle.Claim, PageDragDecision.settle(contentClaimed = false, travelledPx = 14f * density, millisSinceSlop = 90L, density = density))
        assertEquals(PageDragDecision.Settle.Yield, PageDragDecision.settle(contentClaimed = true, travelledPx = 40f * density, millisSinceSlop = 500L, density = density))
    }
}

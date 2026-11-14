package com.ardia.browsing

import com.ardia.browser.FindResult
import com.ardia.browser.PressTarget
import com.ardia.design.PagerPhysics
import com.ardia.store.BrowserTab
import com.ardia.store.NightShadeMode
import com.ardia.store.SwipeNavigationMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowsingRulesTest {
    private fun tab(id: String, url: String = "https://$id.example/", title: String = "") = BrowserTab(id = id, url = url, title = title, created = 0)

    @Test
    fun steppingFindsTheNeighbourOrNothingAtTheEnds() {
        val order = listOf(tab("a"), tab("b"), tab("c"))
        assertEquals("a", SwipeOrder.neighbor(order, "b", -1)?.id)
        assertEquals("c", SwipeOrder.neighbor(order, "b", 1)?.id)
        assertNull(SwipeOrder.neighbor(order, "c", 1))
        assertNull(SwipeOrder.neighbor(order, "missing", 1))
    }

    @Test
    fun theOutgoingCardRecedesAndTheIncomingCardSlidesInFromItsSide() {
        val width = 400f
        assertEquals(-60f, PagerPoses.outgoingX(-200f, width, hasLeft = false, hasRight = true, reduceMotion = false), 0.01f)
        assertEquals(0.96f, PagerPoses.outgoingScale(-200f, width, false, true, false), 0.001f)
        assertEquals(0.16f, PagerPoses.outgoingDim(-200f, width, false, true, false), 0.001f)
        assertEquals(200f, PagerPoses.incomingX(1, -200f, width, false, true, false), 0.01f)
        assertEquals(0f, PagerPoses.incomingOpacity(-1, -200f, width, false, true, false), 0f)
        assertEquals(0.5f, PagerPoses.incomingShadow(1, -200f, width, false, true, false), 0.001f)
    }

    @Test
    fun theirPosesMatchTheSharedPagerLayout() {
        val width = 390.0
        for (offset in listOf(-300.0, -40.0, 0.0, 25.0, 280.0)) {
            val layout = PagerPhysics.layout(offset, width, hasLeft = true, hasRight = true, reduceMotion = false)
            val o = offset.toFloat()
            assertEquals(layout.outgoing.x.toFloat(), PagerPoses.outgoingX(o, width.toFloat(), true, true, false), 0.01f)
            assertEquals(layout.outgoing.scale.toFloat(), PagerPoses.outgoingScale(o, width.toFloat(), true, true, false), 0.001f)
            val incoming = layout.incoming ?: continue
            assertEquals(incoming.x.toFloat(), PagerPoses.incomingX(layout.incomingSide, o, width.toFloat(), true, true, false), 0.01f)
        }
    }

    @Test
    fun withoutANeighbourTheCardRubberBandsAndRawOffsetUndoesIt() {
        val banded = PagerPhysics.resolvedOffset(120.0, hasLeft = false, hasRight = true, width = 400.0).toFloat()
        assertTrue(banded < 60f)
        assertEquals(banded, PagerPoses.outgoingX(banded, 400f, false, true, false), 0.001f)
        assertEquals(120f, PagerPoses.rawOffset(banded, hasLeft = false, hasRight = true), 0.5f)
        assertEquals(150f, PagerPoses.rawOffset(150f, hasLeft = true, hasRight = true), 0f)
    }

    @Test
    fun reducedMotionCrossFadesInPlace() {
        assertEquals(0f, PagerPoses.outgoingX(-200f, 400f, false, true, true), 0f)
        assertEquals(1f, PagerPoses.outgoingScale(-200f, 400f, false, true, true), 0f)
        assertEquals(0f, PagerPoses.incomingX(1, -200f, 400f, false, true, true), 0f)
        assertEquals(0.5f, PagerPoses.incomingOpacity(1, -200f, 400f, false, true, true), 0.001f)
    }

    @Test
    fun swipeNavigationNeedsAHorizontalDragHistoryAndRespectsThePreference() {
        fun direction(mode: SwipeNavigationMode = SwipeNavigationMode.ANYWHERE, dx: Float = 40f, dy: Float = 5f, startX: Float = 200f, canScrollLeft: Boolean = false) =
            SwipeNavigationRules.direction(mode, dx, dy, startX, 400f, 24f, canGoBack = true, canGoForward = false, canScrollLeft = canScrollLeft, canScrollRight = false)
        assertEquals(SwipeDirection.Back, direction())
        assertNull(direction(dx = -40f))
        assertNull(direction(dy = 30f))
        assertNull(direction(canScrollLeft = true))
        assertNull(direction(SwipeNavigationMode.DISABLED))
        assertNull(direction(SwipeNavigationMode.SCREEN_EDGES))
        assertEquals(SwipeDirection.Back, direction(SwipeNavigationMode.SCREEN_EDGES, startX = 10f))
    }

    @Test
    fun aSwipeCommitsPastTheDistanceOrOnAFlickLikeThePhone() {
        assertTrue(SwipeNavigationRules.commits(signed = 200f, signedVelocity = 0f, commit = 150f, flick = 100f))
        assertFalse(SwipeNavigationRules.commits(200f, -400f, 150f, 100f))
        assertTrue(SwipeNavigationRules.commits(120f, 900f, 150f, 100f))
        assertFalse(SwipeNavigationRules.commits(80f, 900f, 150f, 100f))
        assertTrue(SwipeNavigationRules.isPastCommit(140f, wasPast = true, commit = 150f, hysteresis = 24f))
        assertFalse(SwipeNavigationRules.isPastCommit(140f, wasPast = false, commit = 150f, hysteresis = 24f))
        assertEquals(1f, SwipeNavigationRules.progress(-800f, SwipeDirection.Forward, 400f), 0f)
    }

    @Test
    fun pullToRefreshOnlyStartsAtTheTopAndResistsTheFinger() {
        assertTrue(PullToRefreshRules.begins(dx = 2f, dy = 20f, canScrollUp = false))
        assertFalse(PullToRefreshRules.begins(2f, 20f, canScrollUp = true))
        assertFalse(PullToRefreshRules.begins(30f, 20f, false))
        assertTrue(PullToRefreshRules.distance(1000f) < PullToRefreshRules.LIMIT_DP)
        assertFalse(PullToRefreshRules.triggers(PullToRefreshRules.distance(60f)))
        assertTrue(PullToRefreshRules.triggers(PullToRefreshRules.distance(300f)))
    }

    @Test
    fun theMenuTitlePrefersTheSearchThenTheTitleThenTheHost() {
        val search = tab("s", url = "https://www.google.com/search?q=otters", title = "otters - Google")
        assertEquals("otters", PageMenuText.title(search, "otters", "google.com"))
        val page = tab("p", url = "https://example.com/a", title = "")
        assertEquals("example.com", PageMenuText.title(page, page.url, "example.com"))
        assertEquals("A Page", PageMenuText.title(page.copy(title = "A Page"), page.url, "example.com"))
    }

    @Test
    fun nightShadeAutomaticFollowsTheSystemAndZoomShowsAWholePercent() {
        assertTrue(PageMenuText.nightShadeIsOn(NightShadeMode.AUTOMATIC, systemDark = true))
        assertFalse(PageMenuText.nightShadeIsOn(NightShadeMode.AUTOMATIC, systemDark = false))
        assertTrue(PageMenuText.nightShadeIsOn(NightShadeMode.ALWAYS, false))
        assertEquals("115%", PageMenuText.zoomPercent(1.15))
    }

    @Test
    fun readerShowsReadingTimeAndSource() {
        assertEquals(1, PageMenuText.readingMinutes(40))
        assertEquals(4, PageMenuText.readingMinutes(920))
        assertEquals("The Site · Ada", PageMenuText.readerSource("The Site", "Ada"))
        assertNull(PageMenuText.readerSource("", null))
        assertEquals(ReaderTheme.Dark, ReaderTheme.resolve(null, systemDark = true))
        assertEquals(ReaderTheme.Sepia, ReaderTheme.resolve("sepia", systemDark = true))
        assertEquals(ReaderSizes.steps.lastIndex, ReaderSizes.clamp(99))
    }

    @Test
    fun theFindCountShowsPositionOrNoMatchesOnlyForTheCurrentQuery() {
        assertEquals(FindCount.Match(2, 5), FindCount.of(FindResult("cat", 1, 5, true), "cat"))
        assertEquals(FindCount.None, FindCount.of(FindResult("cat", -1, 0, true), "cat"))
        assertNull(FindCount.of(FindResult("cat", -1, 0, false), "cat"))
        assertNull(FindCount.of(FindResult("ca", 0, 3, true), "cat"))
        assertNull(FindCount.of(null, ""))
    }

    @Test
    fun theFileChooserOffersTheCameraOnlyForMediaAndMapsExtensions() {
        val images = FileChooserPlan.of(listOf("image/*"), prefersCapture = false)
        assertTrue(images.offersPhoto)
        assertFalse(images.offersVideo)
        assertFalse(images.capturesDirectly)
        val pdf = FileChooserPlan.of(listOf(".pdf"), prefersCapture = true)
        assertEquals(listOf("application/pdf"), pdf.documentTypes.toList())
        assertFalse(pdf.offersPhoto)
        assertFalse(pdf.capturesDirectly)
        val anything = FileChooserPlan.of(emptyList(), prefersCapture = false)
        assertEquals(listOf("*/*"), anything.documentTypes.toList())
        assertTrue(FileChooserPlan.of(listOf("image/*"), prefersCapture = true).capturesDirectly)
    }

    @Test
    fun longPressOffersTheLinkItemsAndSaveImageForImages() {
        val link = PressMenuItems.of(PressTarget.Link("https://a.example/", "A"))
        assertEquals(listOf(PressAction.OpenInNewTab, PressAction.OpenInBackground, PressAction.CopyLink, PressAction.Share, PressAction.Download), link.flatten())
        val image = PressTarget.Image("https://a.example/i.png", linkUrl = null)
        assertTrue(PressAction.SaveImage in PressMenuItems.of(image).flatten())
        assertFalse(PressAction.Download in PressMenuItems.of(image).flatten())
        assertEquals("https://b.example/", PressMenuItems.linkUrl(PressTarget.Image("https://a.example/i.png", "https://b.example/")))
    }

    @Test
    fun backClosesTheTopmostLayerFirstThenGoesBackThenLeaves() {
        val base = BackState(false, false, false, false, false, false, canGoBack = false, hasTab = true)
        assertEquals(BrowsingLayer.TabSwitcher, BackOrder.next(base))
        assertEquals(BrowsingLayer.PageHistory, BackOrder.next(base.copy(canGoBack = true)))
        assertEquals(BrowsingLayer.FindBar, BackOrder.next(base.copy(canGoBack = true, isFinding = true)))
        assertEquals(BrowsingLayer.Sheet, BackOrder.next(base.copy(isFinding = true, isSheetOpen = true)))
        assertEquals(BrowsingLayer.SubPage, BackOrder.next(base.copy(isSheetOpen = true, isOnSubPage = true)))
        assertEquals(BrowsingLayer.Reader, BackOrder.next(base.copy(isSheetOpen = true, isReading = true)))
        assertEquals(BrowsingLayer.FullscreenVideo, BackOrder.next(base.copy(isReading = true, isFullscreen = true)))
        assertNull(BackOrder.next(base.copy(hasTab = false)))
    }
}

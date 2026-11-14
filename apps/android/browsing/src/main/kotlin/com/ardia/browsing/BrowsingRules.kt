package com.ardia.browsing

import android.Manifest
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.max
import com.ardia.browser.SitePermission
import com.ardia.design.BrowseLayout
import com.ardia.design.PagerPhysics
import com.ardia.store.BrowserTab
import com.ardia.store.NightShadeMode
import com.ardia.store.SwipeNavigationMode
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object BarGeometry {
    fun centerFromBottom(navigationInset: Dp): Dp = max(BrowseLayout.barCenterFromBottom, navigationInset + BrowseLayout.hitTarget / 2)

    fun height(navigationInset: Dp): Dp = BrowseLayout.barHeight + (centerFromBottom(navigationInset) - BrowseLayout.barCenterFromBottom)

    fun pageBottomInset(navigationInset: Dp): Dp = height(navigationInset) - PAGE_OVERLAP

    val PAGE_OVERLAP: Dp = Dp(26f)
}

object PagerPoses {
    fun side(offset: Float, hasLeft: Boolean, hasRight: Boolean): Int = when {
        offset > 0f && hasLeft -> -1
        offset < 0f && hasRight -> 1
        else -> 0
    }

    private fun progress(offset: Float, width: Float): Float = if (width <= 0f) 0f else min(abs(offset) / width, 1f)

    fun outgoingX(offset: Float, width: Float, hasLeft: Boolean, hasRight: Boolean, reduceMotion: Boolean): Float {
        if (width <= 0f || reduceMotion) return 0f
        return if (side(offset, hasLeft, hasRight) == 0) offset else offset * PagerPhysics.parallax.toFloat()
    }

    fun outgoingScale(offset: Float, width: Float, hasLeft: Boolean, hasRight: Boolean, reduceMotion: Boolean): Float {
        if (width <= 0f || reduceMotion) return 1f
        if (side(offset, hasLeft, hasRight) == 0) {
            val pull = min(abs(offset) / PagerPhysics.rubberLimit.toFloat(), 1f)
            return 1f - PagerPhysics.edgeScale.toFloat() * pull
        }
        return 1f - (1f - PagerPhysics.recededScale.toFloat()) * progress(offset, width)
    }

    fun outgoingDim(offset: Float, width: Float, hasLeft: Boolean, hasRight: Boolean, reduceMotion: Boolean): Float {
        if (width <= 0f || reduceMotion || side(offset, hasLeft, hasRight) == 0) return 0f
        return PagerPhysics.recededDim.toFloat() * progress(offset, width)
    }

    fun incomingX(cardSide: Int, offset: Float, width: Float, hasLeft: Boolean, hasRight: Boolean, reduceMotion: Boolean): Float {
        if (side(offset, hasLeft, hasRight) != cardSide || reduceMotion) return 0f
        return cardSide * width + offset
    }

    fun incomingOpacity(cardSide: Int, offset: Float, width: Float, hasLeft: Boolean, hasRight: Boolean, reduceMotion: Boolean): Float {
        if (width <= 0f || side(offset, hasLeft, hasRight) != cardSide) return 0f
        return if (reduceMotion) progress(offset, width) else 1f
    }

    fun incomingShadow(cardSide: Int, offset: Float, width: Float, hasLeft: Boolean, hasRight: Boolean, reduceMotion: Boolean): Float {
        if (width <= 0f || reduceMotion || side(offset, hasLeft, hasRight) != cardSide) return 0f
        return 1f - progress(offset, width)
    }

    fun rawOffset(offset: Float, hasLeft: Boolean, hasRight: Boolean): Float {
        val limit = PagerPhysics.rubberLimit.toFloat()
        if (offset > 0f && !hasLeft) return offset / max(1f - offset / limit, 0.05f)
        if (offset < 0f && !hasRight) return offset / max(1f + offset / limit, 0.05f)
        return offset
    }
}

object SwipeOrder {
    fun neighbor(order: List<BrowserTab>, currentId: String?, delta: Int): BrowserTab? {
        val index = order.indexOfFirst { it.id == currentId }
        if (index < 0) return null
        return order.getOrNull(index + delta)
    }
}

object SwipeNavigationRules {
    const val DOMINANCE = PageSwipe.DOMINANCE
    const val HYSTERESIS_DP = PageSwipe.HYSTERESIS_DP
    const val EDGE_DP = PageSwipe.EDGE_DP
    const val SHADE = PageSwipe.SHADE
    const val PARALLAX = PageSwipe.PARALLAX

    fun direction(
        mode: SwipeNavigationMode,
        dx: Float,
        dy: Float,
        startX: Float,
        width: Float,
        edge: Float,
        canGoBack: Boolean,
        canGoForward: Boolean,
        canScrollLeft: Boolean,
        canScrollRight: Boolean,
    ): SwipeDirection? {
        if (mode == SwipeNavigationMode.DISABLED) return null
        return PageSwipe.direction(mode == SwipeNavigationMode.SCREEN_EDGES, dx, dy, startX, width, edge, canGoBack, canGoForward, canScrollLeft, canScrollRight)
    }

    fun signed(translation: Float, direction: SwipeDirection): Float = PageSwipe.signed(translation, direction)

    fun progress(translation: Float, direction: SwipeDirection, width: Float): Float = PageSwipe.progress(translation, direction, width)

    fun isPastCommit(signed: Float, wasPast: Boolean, commit: Float, hysteresis: Float): Boolean = PageSwipe.isPastCommit(signed, wasPast, commit, hysteresis)

    fun commits(signed: Float, signedVelocity: Float, commit: Float, flick: Float): Boolean = PageSwipe.commits(signed, signedVelocity, commit, flick)
}

object PageMenuText {
    fun title(tab: BrowserTab, query: String, host: String?): String {
        if (query != tab.url) return query
        return tab.title.ifBlank { host ?: tab.url }
    }

    fun zoomPercent(zoom: Double): String = "${(zoom * 100).roundToInt()}%"

    fun nightShadeIsOn(mode: NightShadeMode, systemDark: Boolean): Boolean = when (mode) {
        NightShadeMode.DISABLED -> false
        NightShadeMode.ALWAYS -> true
        NightShadeMode.AUTOMATIC -> systemDark
    }

    fun readingMinutes(wordCount: Int): Int = max(1, (wordCount / 230.0).roundToInt())

    fun readerSource(siteName: String, byline: String?): String? =
        listOf(siteName, byline.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { null }

    fun tabTitle(tab: BrowserTab, host: String?): String = tab.title.ifBlank { host ?: tab.url }
}

object SitePermissions {
    fun android(permission: SitePermission): Array<String> = when (permission) {
        SitePermission.Camera -> arrayOf(Manifest.permission.CAMERA)
        SitePermission.Microphone -> arrayOf(Manifest.permission.RECORD_AUDIO)
        SitePermission.CameraAndMicrophone -> arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        SitePermission.Location -> arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    fun granted(permission: SitePermission, results: Map<String, Boolean>): Boolean = when (permission) {
        SitePermission.Location -> results[Manifest.permission.ACCESS_FINE_LOCATION] == true || results[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        else -> android(permission).all { results[it] == true }
    }
}

enum class BrowsingLayer { FullscreenVideo, PressMenu, FindBar, Reader, SubPage, Sheet, PageHistory, TabSwitcher }

data class BackState(
    val isFullscreen: Boolean,
    val hasPressMenu: Boolean,
    val isFinding: Boolean,
    val isReading: Boolean,
    val isOnSubPage: Boolean,
    val isSheetOpen: Boolean,
    val canGoBack: Boolean,
    val hasTab: Boolean,
)

object BackOrder {
    fun next(state: BackState): BrowsingLayer? = when {
        state.isFullscreen -> BrowsingLayer.FullscreenVideo
        state.hasPressMenu -> BrowsingLayer.PressMenu
        state.isReading -> BrowsingLayer.Reader
        state.isOnSubPage -> BrowsingLayer.SubPage
        state.isSheetOpen -> BrowsingLayer.Sheet
        state.isFinding -> BrowsingLayer.FindBar
        state.canGoBack -> BrowsingLayer.PageHistory
        state.hasTab -> BrowsingLayer.TabSwitcher
        else -> null
    }
}

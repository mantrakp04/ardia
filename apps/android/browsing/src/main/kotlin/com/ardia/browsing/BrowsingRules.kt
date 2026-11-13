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

enum class SwipeDirection { Back, Forward }

object SwipeNavigationRules {
    const val DOMINANCE = 1.6f
    const val HYSTERESIS_DP = 12f
    const val EDGE_DP = 24f
    const val SHADE = 0.12f
    const val PARALLAX = 0.33f

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
        if (abs(dx) <= abs(dy) * DOMINANCE) return null
        val wanted = if (dx > 0) SwipeDirection.Back else SwipeDirection.Forward
        if (mode == SwipeNavigationMode.SCREEN_EDGES) {
            val fromEdge = if (wanted == SwipeDirection.Back) startX <= edge else startX >= width - edge
            if (!fromEdge) return null
        }
        return when (wanted) {
            SwipeDirection.Back -> SwipeDirection.Back.takeIf { canGoBack && !canScrollLeft }
            SwipeDirection.Forward -> SwipeDirection.Forward.takeIf { canGoForward && !canScrollRight }
        }
    }

    fun signed(translation: Float, direction: SwipeDirection): Float = if (direction == SwipeDirection.Back) translation else -translation

    fun progress(translation: Float, direction: SwipeDirection, width: Float): Float =
        (signed(translation, direction) / max(width, 1f)).coerceIn(0f, 1f)

    fun isPastCommit(signed: Float, wasPast: Boolean, commit: Float, hysteresis: Float): Boolean =
        if (wasPast) signed > commit - hysteresis else signed > commit

    fun commits(signed: Float, signedVelocity: Float, commit: Float, flick: Float): Boolean =
        signed > commit && signedVelocity > -50f || signed > flick && signedVelocity > 600f
}

object PullToRefreshRules {
    const val TRIGGER_DP = 64f
    const val LIMIT_DP = 130f
    const val DOMINANCE = 1.2f

    fun begins(dx: Float, dy: Float, canScrollUp: Boolean): Boolean = dy > 0f && dy > abs(dx) * DOMINANCE && !canScrollUp

    fun distance(pulled: Float): Float {
        if (pulled <= 0f) return 0f
        return LIMIT_DP * (1f - 1f / (pulled / LIMIT_DP + 1f))
    }

    fun triggers(distance: Float): Boolean = distance >= TRIGGER_DP
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

data class FileChooserPlan(val documentTypes: Array<String>, val offersPhoto: Boolean, val offersVideo: Boolean, val capturesDirectly: Boolean) {
    override fun equals(other: Any?): Boolean = other is FileChooserPlan && documentTypes.contentEquals(other.documentTypes) &&
        offersPhoto == other.offersPhoto && offersVideo == other.offersVideo && capturesDirectly == other.capturesDirectly

    override fun hashCode(): Int = listOf(documentTypes.toList(), offersPhoto, offersVideo, capturesDirectly).hashCode()

    companion object {
        private val extensionTypes = mapOf(
            "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "gif" to "image/gif", "webp" to "image/webp",
            "heic" to "image/heic", "pdf" to "application/pdf", "txt" to "text/plain", "csv" to "text/csv", "mp4" to "video/mp4",
            "mov" to "video/quicktime", "mp3" to "audio/mpeg", "zip" to "application/zip", "json" to "application/json",
        )

        fun of(acceptTypes: List<String>, prefersCapture: Boolean): FileChooserPlan {
            val types = acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
                .mapNotNull { type -> if (type.startsWith(".")) extensionTypes[type.drop(1)] else type.takeIf { '/' in it } }
                .distinct()
            val anything = types.isEmpty() || "*/*" in types
            val images = anything || types.any { it.startsWith("image/") }
            val videos = anything || types.any { it.startsWith("video/") }
            val documentTypes = if (anything) arrayOf("*/*") else types.toTypedArray()
            return FileChooserPlan(documentTypes, images, videos, prefersCapture && (images || videos))
        }
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

enum class VisualMedia { Images, Videos, ImagesAndVideos }

object PickerChoice {
    fun visualMedia(documentTypes: Array<String>): VisualMedia? {
        if (documentTypes.isEmpty() || documentTypes.any { !it.startsWith("image/") && !it.startsWith("video/") }) return null
        val images = documentTypes.any { it.startsWith("image/") }
        val videos = documentTypes.any { it.startsWith("video/") }
        return when {
            images && videos -> VisualMedia.ImagesAndVideos
            images -> VisualMedia.Images
            else -> VisualMedia.Videos
        }
    }
}

data class PickedFile(val uri: String, val scheme: String?, val authority: String?, val isGranted: Boolean)

object PickedFileRule {
    const val CONTENT_SCHEME = "content"

    fun isOwn(authority: String, ownAuthorities: Set<String>, packageName: String): Boolean =
        ownAuthorities.any { it.equals(authority, ignoreCase = true) } ||
            authority.equals(packageName, ignoreCase = true) || authority.startsWith("$packageName.", ignoreCase = true)

    fun accepts(file: PickedFile, ownAuthorities: Set<String>, packageName: String, captureUri: String?): Boolean {
        if (!file.scheme.equals(CONTENT_SCHEME, ignoreCase = true)) return false
        val authority = file.authority?.takeIf { it.isNotEmpty() } ?: return false
        if (isOwn(authority, ownAuthorities, packageName)) return captureUri != null && file.uri == captureUri
        return file.isGranted
    }

    fun filter(files: List<PickedFile>, ownAuthorities: Set<String>, packageName: String, captureUri: String?): List<PickedFile> =
        files.filter { accepts(it, ownAuthorities, packageName, captureUri) }
}

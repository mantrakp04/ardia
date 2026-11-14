package com.ardia.design

import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.shadow.Shadow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max

@Immutable
sealed interface ToastText {
    data class Plain(val text: String) : ToastText

    data class Resource(@param:StringRes val id: Int, val args: List<Any> = emptyList()) : ToastText

    data class Plural(@param:PluralsRes val id: Int, val count: Int, val args: List<Any> = emptyList()) : ToastText

    fun resolve(resources: Resources): String = when (this) {
        is Plain -> text
        is Resource -> resources.getString(id, *args.toTypedArray())
        is Plural -> resources.getQuantityString(id, count, *args.toTypedArray())
    }

    @Composable
    fun resolve(): String = when (this) {
        is Plain -> text
        is Resource -> stringResource(id, *args.toTypedArray())
        is Plural -> pluralStringResource(id, count, *args.toTypedArray())
    }
}

@Immutable
class Toast(
    val message: ToastText,
    val icon: ImageVector,
    val durationMillis: Long = DEFAULT_DURATION_MILLIS,
    val onTap: (() -> Unit)? = null,
    val id: Long = nextId.incrementAndGet(),
) {
    constructor(message: String, icon: ImageVector, durationMillis: Long = DEFAULT_DURATION_MILLIS, onTap: (() -> Unit)? = null) :
        this(ToastText.Plain(message), icon, durationMillis, onTap)

    override fun equals(other: Any?): Boolean = other is Toast && other.id == id

    override fun hashCode(): Int = id.hashCode()

    companion object {
        const val DEFAULT_DURATION_MILLIS = 2_400L
        const val LONG_DURATION_MILLIS = 3_200L
        private val nextId = AtomicLong(0)
    }
}

object Toasts {
    fun copiedUrl() = Toast(ToastText.Resource(R.string.ardia_toast_copied_url), ArdiaSymbols.link)

    fun copiedUrlWithoutTrackers() = Toast(ToastText.Resource(R.string.ardia_toast_copied_url_without_trackers), ArdiaSymbols.link)

    fun clearedBrowsingData() = Toast(ToastText.Resource(R.string.ardia_toast_cleared_browsing_data), ArdiaSymbols.eraserFill)

    fun noOpenTabsToExport() = Toast(ToastText.Resource(R.string.ardia_toast_no_open_tabs), ArdiaSymbols.squareOnSquareDashed)

    fun syncConnected() = Toast(ToastText.Resource(R.string.ardia_toast_sync_connected), ArdiaSymbols.checkmarkIcloudFill)

    fun tabReceived(deviceName: String, count: Int = 1, onOpen: (() -> Unit)? = null): Toast {
        val message = if (count == 1) {
            ToastText.Resource(R.string.ardia_toast_tab_from, listOf(deviceName))
        } else {
            ToastText.Plural(R.plurals.ardia_toast_tabs_from, count, listOf(count, deviceName))
        }
        return Toast(message, deviceIcon(deviceName), Toast.LONG_DURATION_MILLIS, onOpen)
    }

    fun sentTab(deviceName: String) = Toast(ToastText.Resource(R.string.ardia_toast_sent_to, listOf(deviceName)), ArdiaSymbols.paperplaneFill)

    fun downloaded(fileName: String, onOpen: () -> Unit) =
        Toast(ToastText.Resource(R.string.ardia_toast_downloaded, listOf(fileName)), ArdiaSymbols.arrowDownCircleFill, Toast.LONG_DURATION_MILLIS, onOpen)

    fun downloadFailed(fileName: String): Toast = if (fileName.isEmpty()) {
        Toast(ToastText.Resource(R.string.ardia_toast_download_failed), ArdiaSymbols.exclamationmarkTriangleFill)
    } else {
        Toast(ToastText.Resource(R.string.ardia_toast_download_failed_named, listOf(fileName)), ArdiaSymbols.exclamationmarkTriangleFill)
    }

    fun deviceIcon(deviceName: String): ImageVector {
        val name = deviceName.lowercase()
        return if ("iphone" in name || "android" in name) ArdiaSymbols.iphone else ArdiaSymbols.macbook
    }
}

object ReceivedTabsSender {
    fun name(senders: List<String?>, fallback: String): String {
        val names = senders.mapNotNull { it?.trim() }.filter { it.isNotEmpty() }.toSet()
        return names.singleOrNull() ?: fallback
    }
}

@Stable
class ToastCenter(private val scope: CoroutineScope) {
    var current: Toast? by mutableStateOf(null)
        private set
    private var dismissal: Job? = null
    private var isHeld = false

    fun show(toast: Toast) {
        val showing = current
        if (showing != null && showing.message == toast.message) {
            scheduleDismissal(showing.id, toast.durationMillis)
            return
        }
        current = toast
        scheduleDismissal(toast.id, toast.durationMillis)
    }

    fun show(message: String, icon: ImageVector) = show(Toast(message, icon))

    fun dismiss() {
        dismissal?.cancel()
        dismissal = null
        isHeld = false
        current = null
    }

    fun hold(held: Boolean) {
        val showing = current ?: return
        isHeld = held
        if (held) {
            dismissal?.cancel()
        } else {
            scheduleDismissal(showing.id, RELEASE_MILLIS)
        }
    }

    fun activate() {
        val action = current?.onTap
        dismiss()
        action?.invoke()
    }

    private fun scheduleDismissal(id: Long, durationMillis: Long) {
        dismissal?.cancel()
        if (isHeld) return
        dismissal = scope.launch {
            delay(durationMillis)
            if (current?.id == id) current = null
        }
    }

    companion object {
        const val RELEASE_MILLIS = 1_200L
    }
}

@Composable
fun rememberToastCenter(): ToastCenter {
    val scope = rememberCoroutineScope()
    return remember(scope) { ToastCenter(scope) }
}

object ToastDefaults {
    val barClearance = 64.dp
    val sheetClearance = 12.dp
    val keyboardTop = 4.dp
    val sideInset = Spacing.page * 2
    val iconSize = 17.dp
    val minHeight = 44.dp
    val verticalPadding = 11.dp
    const val FLING_DISTANCE_DP = 40f
    const val DRAG_DISTANCE_DP = 24f
    const val PROJECTION_SECONDS = 0.499f
}

@Composable
fun ToastView(toast: Toast, modifier: Modifier = Modifier) {
    val message = toast.message.resolve()
    Row(
        modifier
            .dropShadow(CircleShape, Shadow(radius = 14.dp, color = Palette.toastShadow.current, offset = DpOffset(0.dp, 6.dp)))
            .background(Palette.toast.current, CircleShape)
            .border(0.5.dp, Palette.panelBorder.current, CircleShape)
            .heightIn(min = ToastDefaults.minHeight)
            .padding(horizontal = Spacing.page, vertical = ToastDefaults.verticalPadding),
        horizontalArrangement = Arrangement.spacedBy(Spacing.tight),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val ink = SystemPalette.label.current
        Icon(toast.icon, null, Modifier.size(ToastDefaults.iconSize), tint = ink)
        Text(message, style = ArdiaType.subheadline.semibold, color = ink, maxLines = 3)
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun ToastHost(center: ToastCenter, modifier: Modifier = Modifier, clearance: Dp = ToastDefaults.barClearance) {
    val keyboard = WindowInsets.isImeVisible
    val reduceMotion = LocalReduceMotion.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val drag = remember { Animatable(0f) }
    var travelled by remember { mutableStateOf(0f) }
    Box(
        modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),
        contentAlignment = if (keyboard) Alignment.TopCenter else Alignment.BottomCenter,
    ) {
        AnimatedContent(
            targetState = center.current,
            contentKey = { it?.id },
            contentAlignment = if (keyboard) Alignment.TopCenter else Alignment.BottomCenter,
            transitionSpec = {
                if (reduceMotion) {
                    fadeIn(Motion.reducedFade.spec()) togetherWith fadeOut(Motion.reducedFade.spec()) using SizeTransform(clip = false)
                } else {
                    val spring = Motion.snappy
                    (
                        slideInVertically(spring.spec(IntOffset.VisibilityThreshold)) { with(density) { 24.dp.roundToPx() } } +
                            fadeIn(spring.spec()) +
                            scaleIn(spring.spec(), initialScale = 0.92f, transformOrigin = TransformOrigin(0.5f, 1f))
                        ) togetherWith (
                        slideOutVertically(spring.spec(IntOffset.VisibilityThreshold)) { with(density) { 16.dp.roundToPx() } } +
                            fadeOut(spring.spec())
                        ) using SizeTransform(clip = false)
                }
            },
            label = "toast",
        ) { toast ->
            if (toast == null) return@AnimatedContent
            val draggable = rememberDraggableState { delta ->
                val next = drag.value + delta / density.density
                travelled = next
                scope.launch { drag.snapTo(next) }
            }
            ToastView(
                toast,
                Modifier
                    .padding(horizontal = ToastDefaults.sideInset)
                    .padding(bottom = if (keyboard) 0.dp else clearance, top = if (keyboard) ToastDefaults.keyboardTop else 0.dp)
                    .offset { IntOffset(0, with(density) { max(drag.value, drag.value / 4).dp.roundToPx() }) }
                    .semantics {
                        liveRegion = LiveRegionMode.Polite
                        if (toast.onTap != null) role = Role.Button
                    }
                    .draggable(
                        draggable,
                        Orientation.Vertical,
                        onDragStarted = {
                            travelled = drag.value
                            center.hold(true)
                        },
                        onDragStopped = { velocity ->
                            val translation = travelled
                            val predicted = translation + velocity / density.density * ToastDefaults.PROJECTION_SECONDS
                            if (predicted > ToastDefaults.FLING_DISTANCE_DP || translation > ToastDefaults.DRAG_DISTANCE_DP) {
                                center.dismiss()
                                drag.snapTo(0f)
                            } else {
                                center.hold(false)
                                drag.animateTo(0f, Motion.snappy.spec())
                            }
                        },
                    )
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { center.activate() },
            )
        }
    }
}

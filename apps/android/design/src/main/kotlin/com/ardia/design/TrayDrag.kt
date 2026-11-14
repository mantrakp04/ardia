package com.ardia.design

import androidx.compose.animation.core.animate
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.min

object TrayDrag {
    const val upwardLimit = 36.0
    const val flickVelocity = 800.0
    const val returnVelocity = -250.0
    const val momentum = 0.12
    const val distanceShare = 0.35
    const val distanceCap = 120.0
    const val keyboardRelease = 8.0

    fun offset(translation: Double): Double {
        if (translation >= 0) return translation
        return -rubberBand(-translation, upwardLimit)
    }

    fun rubberBand(distance: Double, limit: Double): Double {
        if (distance <= 0 || limit <= 0) return 0.0
        return limit * (1 - 1 / (distance / limit + 1))
    }

    fun dismissDistance(trayHeight: Double): Double = min(max(trayHeight, 0.0) * distanceShare, distanceCap)

    fun shouldDismiss(translation: Double, velocity: Double, trayHeight: Double): Boolean {
        if (translation <= 0) return false
        if (velocity <= returnVelocity) return false
        if (velocity >= flickVelocity) return true
        return translation + max(velocity, 0.0) * momentum >= dismissDistance(trayHeight)
    }

    fun releasesKeyboard(translation: Double): Boolean = translation > keyboardRelease

    fun progress(offset: Double, travel: Double): Double {
        if (travel <= 0) return 0.0
        return (offset / travel).coerceIn(0.0, 1.0)
    }
}

@Stable
class TrayDragState {
    var offsetDp: Float by mutableFloatStateOf(0f)
        private set
    var isDragging: Boolean by mutableStateOf(false)
        private set
    private var settleJob: Job? = null

    fun progress(travel: Dp): Float = TrayDrag.progress(offsetDp.toDouble(), travel.value.toDouble()).toFloat()

    internal fun begin() {
        settleJob?.cancel()
        settleJob = null
        isDragging = true
    }

    internal fun follow(translationDp: Double) {
        offsetDp = TrayDrag.offset(translationDp).toFloat()
    }

    internal fun end() {
        isDragging = false
    }

    suspend fun settle(motion: ArdiaMotion = Motion.traySettle) {
        animate(initialValue = offsetDp, targetValue = 0f, animationSpec = motion.spec()) { value, _ -> offsetDp = value }
    }

    internal fun launchSettle(job: Job) {
        settleJob = job
    }

    fun reset() {
        settleJob?.cancel()
        settleJob = null
        isDragging = false
        offsetDp = 0f
    }
}

@Composable
fun rememberTrayDragState(): TrayDragState = remember { TrayDragState() }

fun Modifier.trayDismissDrag(
    state: TrayDragState,
    trayHeight: Dp,
    onDismiss: () -> Unit,
    onReleaseKeyboard: () -> Unit = {},
    settleMotion: ArdiaMotion = Motion.traySettle,
    enabled: Boolean = true,
): Modifier {
    if (!enabled) return this
    return pointerInput(state, trayHeight, settleMotion) {
        coroutineScope {
            var translation = 0.0
            var keyboardReleased = false
            val tracker = VelocityTracker()
            detectVerticalDragGestures(
                onDragStart = {
                    translation = 0.0
                    keyboardReleased = false
                    tracker.resetTracking()
                    state.begin()
                },
                onVerticalDrag = { change, amount ->
                    tracker.addPosition(change.uptimeMillis, change.position)
                    translation += amount / density
                    if (!keyboardReleased && TrayDrag.releasesKeyboard(translation)) {
                        keyboardReleased = true
                        onReleaseKeyboard()
                    }
                    state.follow(translation)
                    change.consume()
                },
                onDragEnd = {
                    state.end()
                    val velocity = tracker.calculateVelocity().y / density
                    if (TrayDrag.shouldDismiss(translation, velocity.toDouble(), trayHeight.value.toDouble())) {
                        onDismiss()
                    } else {
                        state.launchSettle(launch { state.settle(settleMotion) })
                    }
                },
                onDragCancel = {
                    state.end()
                    state.launchSettle(launch { state.settle(settleMotion) })
                },
            )
        }
    }
}

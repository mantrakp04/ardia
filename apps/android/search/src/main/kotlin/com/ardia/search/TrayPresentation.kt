package com.ardia.search

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.Density
import com.ardia.appmodel.BrowseSession
import com.ardia.design.ArdiaMotion
import kotlin.math.abs
import kotlin.math.max
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Stable
internal class KeyboardReader(
    private val ime: WindowInsets,
    private val source: WindowInsets,
    private val target: WindowInsets,
    private val navigation: WindowInsets,
    private val density: Density,
) {
    fun current(): Float = ime.getBottom(density) / density.density

    fun target(): Float = target.getBottom(density) / density.density

    fun progress(): Float = TrayLift.keyboardProgress(current(), source.getBottom(density) / density.density, target())

    fun safeBottom(): Float = navigation.getBottom(density) / density.density
}

@Stable
internal class TrayPresentation(private val scope: CoroutineScope, private val keyboard: KeyboardReader) {
    var shown: BrowseSession.SearchRequest? by mutableStateOf(null)
        private set
    var count: Int by mutableIntStateOf(0)
        private set
    var isClosing: Boolean by mutableStateOf(false)
        private set
    var hasLanded: Boolean by mutableStateOf(false)
        private set
    var heldLift: Float? by mutableStateOf(null)
        private set
    var wantsFocus: Boolean by mutableStateOf(false)
    var trayHeight: Float by mutableFloatStateOf(0f)

    val landing = Animatable(0f)
    val back = Animatable(0f)

    private var landingJob: Job? = null
    private var holdJob: Job? = null
    private var removalJob: Job? = null

    fun liveLift(): Float = TrayLift.liveLift(keyboard.current(), keyboard.safeBottom(), hasLanded, isClosing)

    fun lift(): Float = heldLift ?: liveLift()

    fun rise(reduceMotion: Boolean): Float = if (reduceMotion) 1f else max(landing.value, keyboard.progress())

    fun budgetLift(): Float = heldLift ?: max(keyboard.target(), keyboard.safeBottom())

    fun isUp(): Boolean = TrayLift.isKeyboardUp(keyboard.current()) || (!isClosing && hasLanded)

    fun present(request: BrowseSession.SearchRequest, mayFocus: Boolean, rise: ArdiaMotion) {
        removalJob?.cancel()
        holdJob?.cancel()
        if (shown == null || isClosing) count += 1
        shown = request
        isClosing = false
        heldLift = null
        val landed = TrayLift.isKeyboardUp(keyboard.current()) && keyboard.progress() >= TrayLift.LANDED_PROGRESS
        hasLanded = landed
        wantsFocus = mayFocus
        landingJob?.cancel()
        landingJob = scope.launch {
            landing.snapTo(if (landed) 1f else 0f)
            back.snapTo(0f)
            delay(TrayLift.LANDING_DELAY_MILLIS)
            if (shown == null || isClosing || hasLanded) return@launch
            hasLanded = true
            landing.animateTo(1f, rise.spec())
        }
    }

    fun keyboardMoved(progress: Float, isDragging: Boolean) {
        if (shown != null && !isClosing && !hasLanded && progress >= TrayLift.LANDED_PROGRESS) {
            landingJob?.cancel()
            hasLanded = true
            scope.launch { landing.snapTo(1f) }
        }
        val held = heldLift ?: return
        if (!isDragging && abs(liveLift() - held) < TrayLift.HELD_RELEASE_TOLERANCE) {
            holdJob?.cancel()
            heldLift = null
        }
    }

    fun releaseKeyboard() {
        if (!wantsFocus) return
        if (heldLift == null) heldLift = lift()
        wantsFocus = false
    }

    fun settleAfterDrag(mayFocus: Boolean, settle: ArdiaMotion) {
        if (heldLift == null || shown == null || isClosing) return
        if (mayFocus) wantsFocus = true
        holdJob?.cancel()
        holdJob = scope.launch {
            delay(TrayLift.SETTLE_HOLD_MILLIS)
            val from = heldLift ?: return@launch
            val motion = Animatable(from)
            motion.animateTo(liveLift(), settle.spec()) { heldLift = value }
            heldLift = null
        }
    }

    fun beginClosing(dismiss: ArdiaMotion, onFinished: () -> Unit) {
        if (shown == null || isClosing) return
        landingJob?.cancel()
        holdJob?.cancel()
        wantsFocus = false
        isClosing = true
        val followsKeyboard = TrayLift.isKeyboardUp(keyboard.current()) && heldLift == null
        removalJob?.cancel()
        removalJob = scope.launch {
            if (followsKeyboard) landing.snapTo(0f) else launch { landing.animateTo(0f, dismiss.spec()) }
            var polls = 0
            while (polls < TrayLift.CLOSE_POLLS && TrayLift.isKeyboardUp(keyboard.current())) {
                delay(TrayLift.CLOSE_POLL_MILLIS)
                polls += 1
            }
            delay(TrayLift.REMOVAL_DELAY_MILLIS)
            if (!isClosing) return@launch
            finish()
            onFinished()
        }
    }

    private suspend fun finish() {
        shown = null
        isClosing = false
        hasLanded = false
        heldLift = null
        landing.snapTo(0f)
        back.snapTo(0f)
    }
}

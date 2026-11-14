package com.ardia.search

import kotlin.math.max
import kotlin.math.min

object TrayLift {
    const val KEYBOARD_THRESHOLD = 120f
    const val LANDING_DELAY_MILLIS = 450L
    const val SETTLE_HOLD_MILLIS = 650L
    const val CLOSE_POLL_MILLIS = 50L
    const val CLOSE_POLLS = 20
    const val REMOVAL_DELAY_MILLIS = 450L
    const val HELD_RELEASE_TOLERANCE = 2f
    const val LANDED_PROGRESS = 0.99f

    fun isKeyboardUp(keyboard: Float): Boolean = keyboard > KEYBOARD_THRESHOLD

    fun keyboardProgress(current: Float, source: Float, target: Float): Float {
        val full = max(source, target)
        if (full <= KEYBOARD_THRESHOLD) return 0f
        return (current / full).coerceIn(0f, 1f)
    }

    fun liveLift(keyboard: Float, safeBottom: Float, hasLanded: Boolean, isClosing: Boolean): Float {
        val restsWithoutKeyboard = hasLanded && !isKeyboardUp(keyboard) && !isClosing
        return if (restsWithoutKeyboard) max(keyboard, safeBottom) else keyboard
    }

    fun offset(lift: Float, drag: Float, rise: Float, trayHeight: Float, cornerRadius: Float): Float {
        val clampedRise = rise.coerceIn(0f, 1f)
        return -lift + drag + (1 - clampedRise) * (trayHeight + cornerRadius + lift)
    }

    fun maxHeight(preferred: Float, containerHeight: Float, lift: Float, gap: Float): Float =
        max(min(preferred, containerHeight - lift - gap), 0f)

    fun dragProgress(offset: Float, travel: Float): Float {
        if (travel <= 0f) return 0f
        return (offset / travel).coerceIn(0f, 1f)
    }
}

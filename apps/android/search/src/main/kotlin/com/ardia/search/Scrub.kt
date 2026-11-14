package com.ardia.search

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlin.math.abs

class ScrubTargets(capacity: Int = DEFAULT_CAPACITY) {
    private var tops = FloatArray(capacity)
    private var bottoms = FloatArray(capacity)
    private var lefts = FloatArray(capacity)
    private var rights = FloatArray(capacity)

    var count: Int = 0
        private set

    fun resize(rows: Int) {
        if (rows > tops.size) {
            tops = tops.copyOf(rows)
            bottoms = bottoms.copyOf(rows)
            lefts = lefts.copyOf(rows)
            rights = rights.copyOf(rows)
        }
        for (index in count until rows) {
            tops[index] = 0f
            bottoms[index] = 0f
            lefts[index] = 0f
            rights[index] = 0f
        }
        count = rows
    }

    fun place(index: Int, left: Float, top: Float, right: Float, bottom: Float) {
        if (index !in 0 until count) return
        lefts[index] = left
        tops[index] = top
        rights[index] = right
        bottoms[index] = bottom
    }

    fun top(index: Int): Float = tops[index]

    fun bottom(index: Int): Float = bottoms[index]

    fun left(index: Int): Float = lefts[index]

    fun right(index: Int): Float = rights[index]

    fun hit(x: Float, y: Float, budget: Float, slack: Float): Int {
        if (y > budget) return NONE
        for (index in 0 until count) {
            if (bottoms[index] <= tops[index]) continue
            if (tops[index] <= y && y < bottoms[index] && lefts[index] - slack <= x && x <= rights[index] + slack) return index
        }
        return NONE
    }

    companion object {
        const val NONE = -1
        const val DEFAULT_CAPACITY = 12
    }
}

@Stable
class ScrubState(val targets: ScrubTargets = ScrubTargets()) {
    sealed interface Release {
        data object Nothing : Release

        data class Activate(val index: Int, val wasScrubbing: Boolean) : Release
    }

    var highlighted: Int by mutableIntStateOf(ScrubTargets.NONE)
        private set

    var isScrubbing: Boolean = false
        private set

    private var startX = 0f
    private var startY = 0f

    fun begin(x: Float, y: Float, budget: Float, slack: Float) {
        startX = x
        startY = y
        isScrubbing = false
        highlighted = targets.hit(x, y, budget, slack)
    }

    fun move(x: Float, y: Float, budget: Float, slack: Float, scrubDistance: Float): Boolean {
        if (abs(y - startY) > scrubDistance || abs(x - startX) > scrubDistance) isScrubbing = true
        val hit = targets.hit(x, y, budget, slack)
        if (hit == highlighted) return false
        highlighted = hit
        return isScrubbing && hit != ScrubTargets.NONE
    }

    fun end(x: Float, y: Float, budget: Float, slack: Float): Release {
        val wasScrubbing = isScrubbing
        isScrubbing = false
        highlighted = ScrubTargets.NONE
        val hit = targets.hit(x, y, budget, slack)
        if (hit == ScrubTargets.NONE) return Release.Nothing
        return Release.Activate(hit, wasScrubbing)
    }

    fun cancel() {
        isScrubbing = false
        highlighted = ScrubTargets.NONE
    }
}

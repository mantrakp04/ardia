package com.ardia.tabs

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

object DeckOrder {
    data class Reconciled(val order: List<String>, val scroll: Double)

    fun rounded(value: Double): Int {
        val magnitude = floor(abs(value) + 0.5)
        return (if (value < 0) -magnitude else magnitude).toInt()
    }

    fun focusedIndex(scroll: Double, count: Int): Int = rounded(scroll).coerceIn(0, max(count - 1, 0))

    fun focusedId(order: List<String>, scroll: Double): String? = if (order.isEmpty()) null else order[focusedIndex(scroll, order.size)]

    fun reconcile(order: List<String>, current: List<String>, scroll: Double): Reconciled? {
        val live = current.toHashSet()
        val focused = focusedId(order, scroll)
        val next = ArrayList<String>(current.size)
        order.filterTo(next) { it in live }
        val known = next.toHashSet()
        current.filterTo(next) { it !in known }
        if (next == order) return null
        val focusedIndex = focused?.let(next::indexOf) ?: -1
        val nextScroll = if (focusedIndex >= 0) focusedIndex.toDouble() else min(scroll, max(next.size - 1, 0).toDouble())
        return Reconciled(next, nextScroll)
    }

    fun initialScroll(count: Int): Double = max(0, count - 2).toDouble()

    fun openingScroll(index: Int, count: Int): Double = if (index < count - 1) index.toDouble() else max(0, min(index - 1, count - 1)).toDouble()

    fun handoffScroll(index: Int): Double = max(0, index - 1).toDouble()

    fun slotShift(oldIndex: Int, oldOffset: Double, oldScroll: Double, newIndex: Int, newScroll: Double): Double =
        (oldIndex + oldOffset - oldScroll) - (newIndex - newScroll)
}

package com.ardia.blocking

import com.google.re2j.ArdiaProgramBridge as Bridge

internal class MeteredRegex(pattern: com.google.re2j.Pattern) {
    private val program = Bridge.program(pattern)
    private val ops = program.ops
    private val outs = program.outs
    private val args = program.args
    private val asciiLow = program.asciiLow
    private val asciiHigh = program.asciiHigh
    private val start = program.start
    private val anchored = program.startCondition >= 0 && program.startCondition and Bridge.EMPTY_BEGIN_TEXT != 0
    private val impossible = program.startCondition < 0
    val size: Int = ops.size

    fun find(text: CharArray, length: Int, scratch: RegexScratch): Int {
        if (impossible) return NO_MATCH
        scratch.prepare(size)
        var current = scratch.first
        var next = scratch.second
        current.clear()
        var position = 0
        var previous = -1
        var rune = runeAt(text, position, length)
        while (true) {
            if (position == 0 || !anchored) {
                if (!add(current, start, context(previous, rune), scratch)) return OUT_OF_BUDGET
            } else if (current.count == 0) {
                return NO_MATCH
            }
            val width = if (rune > 0xFFFF) 2 else 1
            val following = if (rune < 0) -1 else runeAt(text, position + width, length)
            val nextContext = if (rune < 0) 0 else context(rune, following)
            next.clear()
            val dense = current.dense
            for (index in 0 until current.count) {
                val pc = dense[index]
                if (--scratch.steps < 0) return OUT_OF_BUDGET
                when (ops[pc]) {
                    Bridge.MATCH -> return MATCH
                    Bridge.RUNE, Bridge.RUNE1 -> if (rune >= 0 && matches(pc, rune) && !add(next, outs[pc], nextContext, scratch)) return OUT_OF_BUDGET
                    Bridge.RUNE_ANY -> if (rune >= 0 && !add(next, outs[pc], nextContext, scratch)) return OUT_OF_BUDGET
                    Bridge.RUNE_ANY_NOT_NL -> if (rune >= 0 && rune != '\n'.code && !add(next, outs[pc], nextContext, scratch)) return OUT_OF_BUDGET
                }
            }
            if (rune < 0) return NO_MATCH
            val swap = current
            current = next
            next = swap
            previous = rune
            position += width
            rune = following
        }
    }

    private fun matches(pc: Int, rune: Int): Boolean {
        if (rune < 64) return asciiLow[pc] and (1L shl rune) != 0L
        if (rune < 128) return asciiHigh[pc] and (1L shl (rune - 64)) != 0L
        return Bridge.matchRune(program.instructions[pc], rune)
    }

    private fun add(list: SparseSet, first: Int, context: Int, scratch: RegexScratch): Boolean {
        val stack = scratch.stack
        var top = 0
        stack[top++] = first
        while (top > 0) {
            val pc = stack[--top]
            if (list.contains(pc)) continue
            list.add(pc)
            if (--scratch.steps < 0) return false
            when (ops[pc]) {
                Bridge.ALT, Bridge.ALT_MATCH -> {
                    stack[top++] = args[pc]
                    stack[top++] = outs[pc]
                }
                Bridge.CAPTURE, Bridge.NOP -> stack[top++] = outs[pc]
                Bridge.EMPTY_WIDTH -> if (args[pc] and context.inv() == 0) stack[top++] = outs[pc]
            }
        }
        return true
    }

    private fun runeAt(text: CharArray, position: Int, length: Int): Int {
        if (position >= length) return -1
        val char = text[position]
        if (Character.isHighSurrogate(char) && position + 1 < length && Character.isLowSurrogate(text[position + 1])) {
            return Character.toCodePoint(char, text[position + 1])
        }
        return char.code
    }

    private fun context(before: Int, after: Int): Int {
        var flags = 0
        if (before < 0) flags = flags or Bridge.EMPTY_BEGIN_TEXT or Bridge.EMPTY_BEGIN_LINE
        if (before == '\n'.code) flags = flags or Bridge.EMPTY_BEGIN_LINE
        if (after < 0) flags = flags or Bridge.EMPTY_END_TEXT or Bridge.EMPTY_END_LINE
        if (after == '\n'.code) flags = flags or Bridge.EMPTY_END_LINE
        flags = flags or if (isWord(before) != isWord(after)) Bridge.EMPTY_WORD_BOUNDARY else Bridge.EMPTY_NO_WORD_BOUNDARY
        return flags
    }

    private fun isWord(rune: Int): Boolean =
        rune in 'a'.code..'z'.code || rune in 'A'.code..'Z'.code || rune in '0'.code..'9'.code || rune == '_'.code

    companion object {
        const val NO_MATCH = 0
        const val MATCH = 1
        const val OUT_OF_BUDGET = -1
    }
}

internal class SparseSet {
    var dense = IntArray(0)
    private var sparse = IntArray(0)
    var count = 0
        private set

    fun ensure(size: Int) {
        if (sparse.size < size) {
            dense = IntArray(size)
            sparse = IntArray(size)
        }
    }

    fun clear() {
        count = 0
    }

    fun contains(value: Int): Boolean {
        val index = sparse[value]
        return index < count && dense[index] == value
    }

    fun add(value: Int) {
        sparse[value] = count
        dense[count++] = value
    }
}

internal class RegexScratch {
    val first = SparseSet()
    val second = SparseSet()
    var stack = IntArray(0)
        private set
    var steps = 0

    fun prepare(size: Int) {
        first.ensure(size)
        second.ensure(size)
        if (stack.size < size * 2 + 2) stack = IntArray(size * 2 + 2)
    }
}

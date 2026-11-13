package com.google.re2j

internal object ArdiaProgramBridge {
    const val ALT = Inst.ALT
    const val ALT_MATCH = Inst.ALT_MATCH
    const val CAPTURE = Inst.CAPTURE
    const val EMPTY_WIDTH = Inst.EMPTY_WIDTH
    const val FAIL = Inst.FAIL
    const val MATCH = Inst.MATCH
    const val NOP = Inst.NOP
    const val RUNE = Inst.RUNE
    const val RUNE1 = Inst.RUNE1
    const val RUNE_ANY = Inst.RUNE_ANY
    const val RUNE_ANY_NOT_NL = Inst.RUNE_ANY_NOT_NL
    const val EMPTY_BEGIN_LINE = 0x01
    const val EMPTY_END_LINE = 0x02
    const val EMPTY_BEGIN_TEXT = 0x04
    const val EMPTY_END_TEXT = 0x08
    const val EMPTY_WORD_BOUNDARY = 0x10
    const val EMPTY_NO_WORD_BOUNDARY = 0x20

    class Program(
        val ops: IntArray,
        val outs: IntArray,
        val args: IntArray,
        val asciiLow: LongArray,
        val asciiHigh: LongArray,
        val instructions: Array<Any>,
        val start: Int,
        val startCondition: Int,
    )

    fun program(pattern: Pattern): Program {
        val prog = pattern.re2().prog
        val count = prog.numInst()
        val ops = IntArray(count)
        val outs = IntArray(count)
        val args = IntArray(count)
        val low = LongArray(count)
        val high = LongArray(count)
        val instructions = Array<Any>(count) { prog.inst[it] }
        for (pc in 0 until count) {
            val inst = prog.inst[pc]
            ops[pc] = inst.op
            outs[pc] = inst.out
            args[pc] = inst.arg
            if (inst.op == Inst.RUNE || inst.op == Inst.RUNE1) {
                for (char in 0 until 128) {
                    if (inst.matchRune(char)) {
                        if (char < 64) low[pc] = low[pc] or (1L shl char) else high[pc] = high[pc] or (1L shl (char - 64))
                    }
                }
            }
        }
        return Program(ops, outs, args, low, high, instructions, prog.start, prog.startCond())
    }

    fun matchRune(instruction: Any, rune: Int): Boolean = (instruction as Inst).matchRune(rune)

    fun foldOrbit(rune: Int): IntArray {
        val orbit = ArrayList<Int>()
        var next = Unicode.simpleFold(rune)
        while (next != rune) {
            orbit += next
            next = Unicode.simpleFold(next)
        }
        return orbit.toIntArray()
    }
}

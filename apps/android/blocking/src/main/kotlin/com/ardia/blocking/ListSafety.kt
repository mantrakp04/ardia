package com.ardia.blocking

data class ListBudget(
    val maxRulesPerList: Int = 250_000,
    val maxCharsPerList: Long = 16_000_000,
    val maxRulesTotal: Int = 500_000,
    val maxCharsTotal: Long = 40_000_000,
)

class FilterListTooLargeException(val listId: String) : Exception("filter list $listId is over its budget")

internal object ListRegex {
    const val MAX_SOURCE_LENGTH = 8_192
    const val MAX_PROGRAM_SIZE = 4_096
    const val MAX_INPUT_LENGTH = 8_192
    const val BASE_STEPS = 500_000
    const val STEPS_PER_CHARACTER = 256

    const val STEPS_PER_RULE_CHECK = 64
    const val MAX_UNINDEXED_PER_LIST = 128
    const val MAX_UNINDEXED_TOTAL = 256

    fun isUnindexed(filter: NetworkFilter): Boolean =
        filter.isRegex && filter.includeDomains.isEmpty() && Tokens.regexCandidates(filter.pattern).isEmpty()

    fun stepsFor(length: Int): Int = BASE_STEPS + STEPS_PER_CHARACTER * minOf(length, MAX_INPUT_LENGTH)
    private const val MAX_REPEAT_PRODUCT = 1_000
    private val budgetSkips = java.util.concurrent.atomic.AtomicLong()

    val rulesSkippedForBudget: Long get() = budgetSkips.get()

    internal fun countBudgetSkip() {
        budgetSkips.incrementAndGet()
    }

    fun compile(source: String, matchCase: Boolean): com.google.re2j.Pattern? {
        if (source.isEmpty() || source.length > MAX_SOURCE_LENGTH || usesQuoting(source) || repeatProduct(source) > MAX_REPEAT_PRODUCT) return null
        val pattern = try {
            com.google.re2j.Pattern.compile(withoutCaptures(source), if (matchCase) 0 else com.google.re2j.Pattern.CASE_INSENSITIVE)
        } catch (error: com.google.re2j.PatternSyntaxException) {
            return null
        } catch (error: RuntimeException) {
            return null
        }
        return pattern.takeIf { it.programSize() <= MAX_PROGRAM_SIZE }
    }

    internal fun usesQuoting(source: String): Boolean {
        var index = 0
        while (index < source.length - 1) {
            if (source[index] == '\\') {
                if (source[index + 1] == 'Q' || source[index + 1] == 'E') return true
                index += 2
            } else {
                index++
            }
        }
        return false
    }

    internal fun dependsOnInputEnd(source: String): Boolean {
        var index = 0
        var inClass = false
        while (index < source.length) {
            val char = source[index]
            when {
                char == '\\' -> {
                    if (!inClass && index + 1 < source.length && source[index + 1] in "zbB") return true
                    index++
                }
                inClass -> if (char == ']') inClass = false
                char == '[' -> inClass = true
                char == '$' -> return true
            }
            index++
        }
        return false
    }

    internal fun withoutCaptures(source: String): String {
        val out = StringBuilder(source.length + 16)
        var index = 0
        var inClass = false
        while (index < source.length) {
            val char = source[index]
            when {
                char == '\\' && index + 1 < source.length -> {
                    out.append(char).append(source[index + 1])
                    index += 2
                    continue
                }
                inClass -> if (char == ']') inClass = false
                char == '[' -> {
                    inClass = true
                    out.append(char)
                    index++
                    if (index < source.length && source[index] == '^') out.append(source[index++])
                    if (index < source.length && source[index] == ']') out.append(source[index++])
                    continue
                }
                char == '(' && !source.startsWith("(?", index) -> {
                    out.append("(?:")
                    index++
                    continue
                }
                char == '(' && (source.startsWith("(?P<", index) || (source.startsWith("(?<", index) && index + 3 < source.length && source[index + 3].isLetter())) -> {
                    val close = source.indexOf('>', index)
                    if (close > 0) {
                        out.append("(?:")
                        index = close + 1
                        continue
                    }
                }
            }
            out.append(char)
            index++
        }
        return out.toString()
    }

    private fun repeatProduct(source: String): Long {
        var index = 0

        fun count(close: Int): Long =
            source.substring(index + 1, close).split(',').mapNotNull { it.trim().toLongOrNull() }.maxOrNull() ?: 1L

        fun repeatAfter(): Long {
            if (index >= source.length) return 1L
            return when (source[index]) {
                '*', '+', '?' -> {
                    index++
                    if (index < source.length && (source[index] == '?' || source[index] == '+')) index++
                    1L
                }
                '{' -> {
                    val close = source.indexOf('}', index)
                    if (close < 0) return 1L
                    val value = count(close)
                    index = close + 1
                    if (index < source.length && (source[index] == '?' || source[index] == '+')) index++
                    maxOf(1L, value)
                }
                else -> 1L
            }
        }

        fun group(): Long {
            var worst = 1L
            while (index < source.length && source[index] != ')') {
                val element = when (source[index]) {
                    '\\' -> {
                        index += 2
                        1L
                    }
                    '[' -> {
                        index++
                        if (index < source.length && source[index] == '^') index++
                        if (index < source.length && source[index] == ']') index++
                        while (index < source.length && source[index] != ']') index += if (source[index] == '\\') 2 else 1
                        index++
                        1L
                    }
                    '(' -> {
                        index++
                        val inner = group()
                        index++
                        inner
                    }
                    else -> {
                        index++
                        1L
                    }
                }
                worst = maxOf(worst, minOf(element * repeatAfter(), Long.MAX_VALUE / 4))
            }
            return worst
        }

        var worst = 1L
        while (index < source.length) {
            worst = maxOf(worst, group())
            index++
        }
        return worst
    }
}

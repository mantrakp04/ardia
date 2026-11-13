package com.ardia.blocking

data class ListBudget(
    val maxRulesPerList: Int = 250_000,
    val maxCharsPerList: Long = 16_000_000,
    val maxRulesTotal: Int = 500_000,
    val maxCharsTotal: Long = 40_000_000,
)

class FilterListTooLargeException(val listId: String) : Exception("filter list $listId is over its budget")

internal object ListRegex {
    const val MAX_SOURCE_LENGTH = 1024
    const val MAX_PROGRAM_SIZE = 200
    const val MAX_INPUT_LENGTH = 512
    const val STEPS_PER_REQUEST = MAX_PROGRAM_SIZE * MAX_INPUT_LENGTH
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

    internal fun anchorsAtEnd(source: String): Boolean {
        var index = 0
        var inClass = false
        while (index < source.length) {
            val char = source[index]
            when {
                char == '\\' -> index++
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
        val frames = ArrayList<Long>()
        frames += 1L
        var element = 1L
        var worst = 1L
        var index = 0
        while (index < source.length) {
            when (source[index]) {
                '\\' -> {
                    element = 1L
                    index++
                }
                '[' -> {
                    index++
                    if (index < source.length && source[index] == ']') index++
                    while (index < source.length && source[index] != ']') {
                        if (source[index] == '\\') index++
                        index++
                    }
                    element = 1L
                }
                '(' -> {
                    frames += 1L
                    element = 1L
                }
                ')' -> {
                    element = if (frames.size > 1) frames.removeAt(frames.size - 1) else 1L
                }
                '{' -> {
                    val close = source.indexOf('}', index)
                    if (close > index) {
                        val count = source.substring(index + 1, close).split(',').mapNotNull { it.trim().toLongOrNull() }.maxOrNull() ?: 1L
                        element *= maxOf(1L, count)
                        index = close
                    }
                }
                else -> element = 1L
            }
            val frame = frames.size - 1
            frames[frame] = maxOf(frames[frame], element)
            worst = maxOf(worst, frames.fold(1L) { product, value -> if (product > Long.MAX_VALUE / 2000) product else product * value } )
            index++
        }
        return worst
    }
}

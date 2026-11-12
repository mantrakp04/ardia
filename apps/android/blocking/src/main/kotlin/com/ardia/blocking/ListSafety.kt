package com.ardia.blocking

data class ListBudget(
    val maxRulesPerList: Int = 250_000,
    val maxCharsPerList: Long = 16_000_000,
    val maxRulesTotal: Int = 500_000,
    val maxCharsTotal: Long = 40_000_000,
)

class FilterListTooLargeException(val listId: String) : Exception("filter list $listId is over its budget")

internal object RegexSafety {
    const val MAX_SOURCE_LENGTH = 1024
    private const val MAX_REPEAT = 1000
    private const val MAX_UNBOUNDED = 4

    private class Group {
        var quantifiedInside = false
        var alternation = false
    }

    fun isSafe(source: String): Boolean {
        if (source.isEmpty() || source.length > MAX_SOURCE_LENGTH) return false
        val stack = ArrayList<Group>()
        stack += Group()
        var unbounded = 0
        var hasAtom = false
        var closedGroup: Group? = null
        var index = 0
        while (index < source.length) {
            val char = source[index]
            when (char) {
                '\\' -> {
                    if (index + 1 >= source.length) return false
                    val next = source[index + 1]
                    if (next in '1'..'9' || next in "kpPQEx") return false
                    index += 2
                    hasAtom = true
                    closedGroup = null
                    continue
                }
                '[' -> {
                    var end = index + 1
                    if (end < source.length && source[end] == '^') end++
                    if (end < source.length && source[end] == ']') end++
                    while (end < source.length && source[end] != ']') {
                        when (source[end]) {
                            '\\' -> end++
                            '[' -> return false
                        }
                        end++
                    }
                    if (end >= source.length) return false
                    if (source.substring(index, end).contains("&&")) return false
                    index = end + 1
                    hasAtom = true
                    closedGroup = null
                    continue
                }
                '(' -> {
                    var bodyStart = index + 1
                    if (bodyStart < source.length && source[bodyStart] == '?') {
                        bodyStart = when {
                            source.startsWith("(?:", index) -> index + 3
                            source.startsWith("(?<", index) && index + 3 < source.length && source[index + 3].isLetter() -> {
                                val close = source.indexOf('>', index)
                                if (close < 0) return false
                                close + 1
                            }
                            else -> return false
                        }
                    }
                    stack += Group()
                    hasAtom = false
                    closedGroup = null
                    index = bodyStart
                    continue
                }
                ')' -> {
                    if (stack.size == 1) return false
                    val group = stack.removeAt(stack.size - 1)
                    val parent = stack.last()
                    parent.quantifiedInside = parent.quantifiedInside || group.quantifiedInside
                    parent.alternation = parent.alternation || group.alternation
                    closedGroup = group
                    hasAtom = true
                }
                '|' -> {
                    stack.last().alternation = true
                    hasAtom = false
                    closedGroup = null
                }
                '*', '+', '?', '{' -> {
                    if (!hasAtom) return false
                    var repeating = char != '?'
                    var isUnbounded = char == '*' || char == '+'
                    var end = index + 1
                    if (char == '{') {
                        val close = source.indexOf('}', index)
                        if (close < 0) return false
                        val parts = source.substring(index + 1, close).split(',')
                        if (parts.size > 2) return false
                        val low = parts[0].toIntOrNull() ?: return false
                        val high = if (parts.size == 1) low else if (parts[1].isEmpty()) null else parts[1].toIntOrNull() ?: return false
                        if (low > MAX_REPEAT || (high != null && (high > MAX_REPEAT || high < low))) return false
                        isUnbounded = high == null
                        repeating = high == null || high > 1
                        end = close + 1
                    }
                    if (end < source.length && (source[end] == '?' || source[end] == '+')) end++
                    if (isUnbounded && ++unbounded > MAX_UNBOUNDED) return false
                    val quantified = closedGroup
                    if (repeating && quantified != null && (quantified.quantifiedInside || quantified.alternation)) return false
                    stack.last().quantifiedInside = true
                    hasAtom = false
                    closedGroup = null
                    index = end
                    continue
                }
                else -> {
                    hasAtom = true
                    closedGroup = null
                }
            }
            index++
        }
        return stack.size == 1
    }
}

internal object RegexBudgetExceeded : RuntimeException(null, null, false, false)

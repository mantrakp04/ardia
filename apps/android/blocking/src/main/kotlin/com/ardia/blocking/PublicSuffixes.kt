package com.ardia.blocking

import java.net.IDN

internal class PublicSuffixes private constructor(
    private val rules: LongHashSet,
    private val wildcards: LongHashSet,
    private val exceptions: LongHashSet,
) {
    fun registrableStart(chars: CharArray, start: Int, end: Int, labels: IntArray): Int {
        if (isAddress(chars, start, end)) return start
        var count = 0
        labels[count++] = start
        for (index in start until end) {
            if (chars[index] == '.' && index + 1 < end) {
                if (count == labels.size) {
                    System.arraycopy(labels, 1, labels, 0, labels.size - 1)
                    count--
                }
                labels[count++] = index + 1
            }
        }
        var suffixLabel = count - 1
        for (label in 0 until count) {
            val from = labels[label]
            val hash = HostHash.of(chars, from, end)
            if (exceptions.contains(hash)) {
                suffixLabel = label + 1
                break
            }
            if (rules.contains(hash)) {
                suffixLabel = label
                break
            }
            if (label + 1 < count && wildcards.contains(HostHash.of(chars, labels[label + 1], end))) {
                suffixLabel = label
                break
            }
        }
        if (suffixLabel <= 0) return start
        return labels[suffixLabel - 1]
    }

    fun registrableDomain(host: String): String {
        val chars = host.lowercase().toCharArray()
        val start = registrableStart(chars, 0, chars.size, IntArray(RequestContext.MAX_LABELS))
        return String(chars, start, chars.size - start)
    }

    private fun isAddress(chars: CharArray, start: Int, end: Int): Boolean {
        if (start < end && chars[start] == '[') return true
        for (index in start until end) {
            val char = chars[index]
            if (char != '.' && char !in '0'..'9') return false
        }
        return true
    }

    companion object {
        val shared: PublicSuffixes by lazy { load() }

        private fun load(): PublicSuffixes {
            val rules = LongHashSet(16384)
            val wildcards = LongHashSet(512)
            val exceptions = LongHashSet(32)
            val stream = PublicSuffixes::class.java.getResourceAsStream("/com/ardia/blocking/public_suffix_list.dat")
            stream?.bufferedReader(Charsets.UTF_8)?.useLines { lines ->
                for (raw in lines) {
                    val line = raw.trim()
                    if (line.isEmpty() || line.startsWith("//")) continue
                    when {
                        line.startsWith("!") -> exceptions.add(HostHash.of(ascii(line.substring(1))))
                        line.startsWith("*.") -> wildcards.add(HostHash.of(ascii(line.substring(2))))
                        else -> rules.add(HostHash.of(ascii(line)))
                    }
                }
            }
            return PublicSuffixes(rules, wildcards, exceptions)
        }

        private fun ascii(rule: String): String {
            if (rule.all { it.code < 0x80 }) return rule.lowercase()
            return runCatching { IDN.toASCII(rule, IDN.ALLOW_UNASSIGNED).lowercase() }.getOrDefault(rule.lowercase())
        }
    }
}

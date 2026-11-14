package com.ardia.sync.core

import java.security.MessageDigest
import java.security.SecureRandom

object RecoveryPhrase {
    const val WORD_COUNT = 24
    const val ENTROPY_BYTES = 32

    sealed class Problem(message: String) : Exception(message) {
        data class WordCount(val count: Int) : Problem("expected $WORD_COUNT words, got $count")
        data class UnknownWord(val word: String) : Problem("unknown word $word")
        data object Checksum : Problem("checksum")
    }

    private val random = SecureRandom()
    private val lookup: Map<String, Int> = Wordlist.english.withIndex().associate { it.value to it.index }
    private val prefixes: Map<String, Int> = Wordlist.english.withIndex().associate { it.value.take(4) to it.index }

    fun generateEntropy(): ByteArray = ByteArray(ENTROPY_BYTES).also { random.nextBytes(it) }

    fun words(entropy: ByteArray): List<String> {
        require(entropy.size == ENTROPY_BYTES)
        val bits = ArrayList<Int>(264)
        for (byte in entropy) for (shift in 7 downTo 0) bits += (byte.toInt() shr shift) and 1
        val checksum = sha256(entropy)[0].toInt()
        for (shift in 7 downTo 0) bits += (checksum shr shift) and 1
        return (0 until bits.size step 11).map { start ->
            Wordlist.english[(start until start + 11).fold(0) { acc, i -> (acc shl 1) or bits[i] }]
        }
    }

    fun tokens(text: String): List<String> {
        val out = ArrayList<String>()
        val current = StringBuilder()
        val lower = text.lowercase()
        var index = 0
        while (index < lower.length) {
            val point = lower.codePointAt(index)
            if (Character.getType(point) == Character.LOWERCASE_LETTER.toInt()) {
                current.appendCodePoint(point)
            } else if (current.isNotEmpty()) {
                out += current.toString()
                current.setLength(0)
            }
            index += Character.charCount(point)
        }
        if (current.isNotEmpty()) out += current.toString()
        return out
    }

    internal fun index(token: String): Int? {
        lookup[token]?.let { return it }
        if (token.codePointCount(0, token.length) < 4) return null
        val prefix = token.substring(0, token.offsetByCodePoints(0, 4))
        return prefixes[prefix]?.takeIf { Wordlist.english[it].startsWith(token) }
    }

    fun entropy(text: String): ByteArray {
        val tokens = tokens(text)
        if (tokens.size != WORD_COUNT) throw Problem.WordCount(tokens.size)
        val bits = ArrayList<Int>(264)
        for (token in tokens) {
            val i = index(token) ?: throw Problem.UnknownWord(token)
            for (shift in 10 downTo 0) bits += (i shr shift) and 1
        }
        val entropy = ByteArray(ENTROPY_BYTES) { byte ->
            (0 until 8).fold(0) { acc, bit -> (acc shl 1) or bits[byte * 8 + bit] }.toByte()
        }
        val checksum = (ENTROPY_BYTES * 8 until bits.size).fold(0) { acc, i -> (acc shl 1) or bits[i] }
        if ((sha256(entropy)[0].toInt() and 0xff) != checksum) throw Problem.Checksum
        return entropy
    }

    private fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
}

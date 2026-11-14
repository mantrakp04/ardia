package com.ardia.sync.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class RecoveryPhraseTest {
    @Test
    fun referenceVectors() {
        val vectors = listOf(
            0x00 to (List(23) { "abandon" } + "art").joinToString(" "),
            0x7f to "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
            0x80 to "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless",
            0xff to (List(23) { "zoo" } + "vote").joinToString(" "),
        )
        for ((byte, phrase) in vectors) {
            val entropy = ByteArray(32) { byte.toByte() }
            assertEquals(phrase, RecoveryPhrase.words(entropy).joinToString(" "))
            assertArrayEquals(entropy, RecoveryPhrase.entropy(phrase))
        }
    }

    @Test
    fun theWordlistIsBip39English() {
        assertEquals(2048, Wordlist.english.size)
        assertEquals(2048, Wordlist.english.toSet().size)
        assertEquals("abandon", Wordlist.english.first())
        assertEquals("zoo", Wordlist.english.last())
        assertEquals(2048, Wordlist.english.map { it.take(4) }.toSet().size)
    }

    @Test
    fun aPrintedKitAndPrefixesRead() {
        val entropy = RecoveryPhrase.generateEntropy()
        val words = RecoveryPhrase.words(entropy)
        val kit = words.withIndex().joinToString("\n") { "${it.index + 1}. ${it.value.uppercase()}" }
        assertArrayEquals(entropy, RecoveryPhrase.entropy(kit))
        val prefixed = words.joinToString(" ") { if (it.length > 4) it.take(4) else it }
        assertArrayEquals(entropy, RecoveryPhrase.entropy(prefixed))
    }

    @Test
    fun problemsAreNamed() {
        val words = RecoveryPhrase.words(RecoveryPhrase.generateEntropy())
        assertEquals(RecoveryPhrase.Problem.WordCount(23), assertThrows(RecoveryPhrase.Problem::class.java) { RecoveryPhrase.entropy(words.dropLast(1).joinToString(" ")) })
        assertEquals(RecoveryPhrase.Problem.UnknownWord("zzzzzz"), assertThrows(RecoveryPhrase.Problem::class.java) { RecoveryPhrase.entropy((words.dropLast(1) + "zzzzzz").joinToString(" ")) })
        val flipped = (List(23) { "abandon" } + "ability").joinToString(" ")
        assertEquals(RecoveryPhrase.Problem.Checksum, assertThrows(RecoveryPhrase.Problem::class.java) { RecoveryPhrase.entropy(flipped) })
    }

    @Test
    fun tokensKeepUnicodeLowercaseLettersTogether() {
        assertEquals(listOf("café", "zoo"), RecoveryPhrase.tokens("CafÉ, 12 zoo!"))
    }
}

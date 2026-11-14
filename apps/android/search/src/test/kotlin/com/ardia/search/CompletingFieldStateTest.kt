package com.ardia.search

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.ardia.store.CompletionOffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompletingFieldStateTest {
    private fun typing(state: CompletingFieldState, text: String): Boolean = state.edit(TextFieldValue(text, TextRange(text.length)))

    private fun focused(initial: String = ""): CompletingFieldState = CompletingFieldState(initial).also { it.focusChanged(true) }

    @Test
    fun anOfferForWhatWasTypedShowsTheRestAsASuffixOutsideTheBuffer() {
        val state = focused()
        typing(state, "wik")
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertEquals("ipedia.org", state.suffix)
        assertEquals("wik", state.value.text)
        assertEquals("wikipedia.org", state.display)
    }

    @Test
    fun typingTheNextCompletedLetterKeepsTheCompletionWithoutAskingAgain() {
        val state = focused()
        typing(state, "wik")
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertTrue(typing(state, "wiki"))
        assertEquals("pedia.org", state.suffix)
        assertEquals("wiki", state.typed)
    }

    @Test
    fun typingADifferentLetterDropsTheCompletion() {
        val state = focused()
        typing(state, "wik")
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        typing(state, "wikx")
        assertEquals("", state.suffix)
        assertEquals("wikx", state.typed)
    }

    @Test
    fun backspaceRemovesOnlyTheCompletionAndSuppressesTheNextOffer() {
        val state = focused()
        typing(state, "wik")
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertFalse(typing(state, "wi"))
        assertEquals("wik", state.value.text)
        assertEquals("", state.suffix)
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertEquals("", state.suffix)
        typing(state, "wiki")
        state.offer(CompletionOffer("wiki", "wikipedia.org"))
        assertEquals("pedia.org", state.suffix)
    }

    @Test
    fun backspaceWithoutACompletionDeletesALetter() {
        val state = focused()
        typing(state, "wik")
        assertTrue(typing(state, "wi"))
        assertEquals("wi", state.typed)
    }

    @Test
    fun movingTheCaretBackAcceptsTheCompletion() {
        val state = focused()
        typing(state, "wik")
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertTrue(state.edit(TextFieldValue("wik", TextRange(1))))
        assertEquals("wikipedia.org", state.typed)
        assertEquals("", state.suffix)
        assertEquals(TextRange(1), state.value.selection)
    }

    @Test
    fun anOfferForAnOlderQueryThatNoLongerMatchesIsIgnored() {
        val state = focused()
        typing(state, "apx")
        state.offer(CompletionOffer("ap", "apple.com"))
        assertEquals("", state.suffix)
    }

    @Test
    fun anUnfocusedFieldShowsNoCompletionAndLosingFocusDropsIt() {
        val state = CompletingFieldState()
        typing(state, "wik")
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertEquals("", state.suffix)
        state.focusChanged(true)
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertEquals("ipedia.org", state.suffix)
        state.focusChanged(false)
        assertEquals("", state.suffix)
    }

    @Test
    fun aComposingCjkWordShowsNoCompletion() {
        val state = focused()
        state.edit(TextFieldValue("にほ", TextRange(2), composition = TextRange(0, 2)))
        state.offer(CompletionOffer("にほ", "にほんご"))
        assertEquals("", state.suffix)
    }

    @Test
    fun aComposingLatinWordStillCompletes() {
        val state = focused()
        state.edit(TextFieldValue("wik", TextRange(3), composition = TextRange(0, 3)))
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        assertEquals("ipedia.org", state.suffix)
    }

    @Test
    fun selectAllThenTypingReplacesEverything() {
        val state = CompletingFieldState("https://apple.com", selectsAll = true)
        state.focusChanged(true)
        assertEquals(TextRange(0, 17), state.value.selection)
        assertTrue(typing(state, "n"))
        assertEquals("n", state.typed)
    }

    @Test
    fun resetClearsTextAndCompletion() {
        val state = focused()
        typing(state, "wik")
        state.offer(CompletionOffer("wik", "wikipedia.org"))
        state.reset("")
        assertEquals("", state.typed)
        assertEquals("", state.suffix)
    }
}

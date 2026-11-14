package com.ardia.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InlineCompletionTest {
    private fun editor(typed: String, query: String = typed, completion: String? = "github.com") =
        InlineCompletionEditor(typed).apply { receive(CompletionOffer(query, completion)) }

    @Test
    fun typingThroughACompletionKeepsEveryCharacter() {
        val editor = editor("g")
        assertEquals("ithub.com", editor.suffix)
        for (character in "ithub") assertEquals(InlineCompletionEditor.Edit.CONSUMED, editor.insert(character.toString()))
        assertEquals("github", editor.typed)
        assertEquals("github.com", editor.display)
    }

    @Test
    fun aStaleOfferForAnEarlierPrefixStillCompletesTheCurrentText() {
        assertEquals("thub.com", editor("gi", query = "g").suffix)
    }

    @Test
    fun aStaleOfferThatNoLongerMatchesLeavesTheFieldAlone() {
        val editor = editor("gl", query = "g")
        assertTrue(editor.suffix.isEmpty())
        assertEquals("gl", editor.typed)
    }

    @Test
    fun aCurrentOfferWithoutACompletionClearsTheSuffix() {
        val editor = editor("git")
        assertTrue(editor.hasSuffix)
        editor.receive(CompletionOffer("git", null))
        assertFalse(editor.hasSuffix)
    }

    @Test
    fun anOfferForADifferentQueryWithoutACompletionIsIgnored() {
        val editor = editor("git")
        editor.receive(CompletionOffer("gi", null))
        assertEquals("hub.com", editor.suffix)
    }

    @Test
    fun aDifferingCharacterDropsTheSuffixAndLetsTheKeyboardInsert() {
        val editor = editor("git")
        assertEquals(InlineCompletionEditor.Edit.INSERT_TYPED, editor.insert("l"))
        assertFalse(editor.hasSuffix)
        assertEquals("git", editor.typed)
    }

    @Test
    fun matchingIsCaseInsensitiveAndKeepsTheTypedCase() {
        val editor = editor("Gi")
        assertEquals("thub.com", editor.suffix)
        assertEquals(InlineCompletionEditor.Edit.CONSUMED, editor.insert("T"))
        assertEquals("GiThub.com", editor.display)
    }

    @Test
    fun pastingTextThatContinuesTheCompletionIsConsumed() {
        val editor = editor("g")
        assertEquals(InlineCompletionEditor.Edit.CONSUMED, editor.insert("ithub."))
        assertEquals("github.", editor.typed)
        assertEquals("com", editor.suffix)
    }

    @Test
    fun deleteRemovesTheCompletionFirstThenSuppressesNewOnesUntilTyping() {
        val editor = editor("git")
        assertEquals(InlineCompletionEditor.Edit.CONSUMED, editor.deleteBackward())
        assertEquals("git", editor.typed)
        editor.receive(CompletionOffer("git", "github.com"))
        assertFalse(editor.hasSuffix)
        assertEquals(InlineCompletionEditor.Edit.INSERT_TYPED, editor.deleteBackward())
        editor.syncTyped("gi")
        editor.insert("t")
        editor.syncTyped("git")
        editor.receive(CompletionOffer("git", "github.com"))
        assertEquals("hub.com", editor.suffix)
    }

    @Test
    fun acceptingFoldsTheSuffixIntoTheTypedText() {
        val editor = editor("git")
        editor.accept()
        assertEquals("github.com", editor.typed)
        assertFalse(editor.hasSuffix)
    }

    @Test
    fun emptyTextNeverShowsACompletion() {
        val editor = InlineCompletionEditor()
        assertFalse(editor.receive(CompletionOffer("", "github.com")))
        assertFalse(editor.hasSuffix)
    }

    @Test
    fun resetClearsSuppressionAndReceiveReportsOnlyRealChanges() {
        val editor = editor("git")
        editor.deleteBackward()
        editor.reset("gi")
        assertTrue(editor.receive(CompletionOffer("gi", "github.com")))
        assertFalse(editor.receive(CompletionOffer("gi", "github.com")))
        assertFalse(editor.receive(null))
    }

    @Test
    fun theResultTurnsIntoAnOfferOnlyForANonEmptyQuery() {
        assertEquals(CompletionOffer("git", "github.com"), OmniboxResult("git", emptyList(), "hub.com").completion)
        assertEquals(CompletionOffer("git", null), OmniboxResult("git", emptyList(), "").completion)
        assertEquals(null, OmniboxResult.empty.completion)
    }
}

package com.ardia.phone

import com.ardia.search.DictationProblem
import com.ardia.settings.SyncCodeJudge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScanAndSpeechPayloadsTest {
    @Test
    fun aValidCodeIsSentOnceTrimmedAndAnInvalidOneOnlySaysItWasRejected() {
        val judge = SyncCodeJudge { it.trim() == "valid words" }
        assertEquals(ScanPayloads.Event("onCode", mapOf("text" to "valid words")), ScanPayloads.event(judge.judge("  valid words  ")))
        assertNull(ScanPayloads.event(judge.judge("  valid words  ")))
        val rejected = ScanPayloads.event(judge.judge("https://not-a-phrase.example/"))
        assertEquals(ScanPayloads.Event("onRejected", emptyMap()), rejected)
        assertNull(ScanPayloads.event(judge.judge("https://not-a-phrase.example/")))
    }

    @Test
    fun speechEventsCarryTheSessionAndTheProblemNames() {
        assertEquals(mapOf("type" to "text", "session" to 3, "text" to "red pandas", "isFinal" to false), SpeechPayloads.text(3, "red pandas", false))
        assertEquals(mapOf("type" to "level", "session" to 3, "level" to 0.5), SpeechPayloads.level(3, 0.5f))
        assertEquals(mapOf("type" to "failure", "session" to 3, "problem" to "language"), SpeechPayloads.failure(3, DictationProblem.Language))
        assertEquals(mapOf("type" to "failure", "session" to 3, "problem" to "service"), SpeechPayloads.failure(3, DictationProblem.Service))
        assertEquals(mapOf("type" to "failure", "session" to 3, "problem" to null), SpeechPayloads.failure(3, null))
        assertEquals(mapOf("type" to "failure", "session" to 3, "problem" to null), SpeechPayloads.failure(3, DictationProblem.HeardNothing))
        assertEquals("granted", SpeechPayloads.access(granted = true, available = true))
        assertEquals("denied", SpeechPayloads.access(granted = false, available = true))
        assertEquals("unavailable", SpeechPayloads.access(granted = true, available = false))
    }
}

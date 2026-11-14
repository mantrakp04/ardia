package com.ardia.sync

import com.ardia.sync.core.RecoveryPhrase

data class PhraseCheck(val wordCount: Int, val counterText: String, val isTooLong: Boolean, val problem: String?, val isValid: Boolean)

sealed interface ConnectResult {
    data object Connected : ConnectResult
    data class InvalidPhrase(val problem: String) : ConnectResult
    data object Mismatch : ConnectResult
    data object NoSyncData : ConnectResult
    data object FolderUnavailable : ConnectResult
    data object KeyStoreFailed : ConnectResult
    data object Busy : ConnectResult

    val message: String?
        get() = when (this) {
            Connected -> null
            is InvalidPhrase -> problem
            Mismatch -> "This recovery phrase doesn’t match the synced data in this folder. Check the phrase, or choose the folder your other devices sync to."
            NoSyncData -> "There’s no synced data in this folder yet. Choose the folder your other devices sync to, or wait for it to finish downloading."
            FolderUnavailable -> "Ardia can’t open this folder. Choose the Ardia Sync folder your Mac syncs to."
            KeyStoreFailed -> "Couldn’t save the sync key on this phone."
            Busy -> "Ardia is still turning off sync. Try again in a moment."
        }
}

data class PhraseFooter(val text: String, val tone: Tone) {
    enum class Tone { HINT, PROBLEM, GOOD }
}

object SyncJoin {
    const val WORD_COUNT = RecoveryPhrase.WORD_COUNT
    const val MAC_HINT = "On your Mac: Settings › Sync › Connect Another Device."
    const val SCAN_REJECTED = "Not an Ardia sync code."

    fun check(phrase: String): PhraseCheck {
        val count = RecoveryPhrase.tokens(phrase).size
        val tooLong = count > WORD_COUNT
        var problem: String? = null
        var valid = false
        if (count == WORD_COUNT) {
            try {
                RecoveryPhrase.entropy(phrase)
                valid = true
            } catch (failure: RecoveryPhrase.Problem) {
                problem = message(failure)
            }
        }
        return PhraseCheck(count, if (tooLong) "too many words" else "$count/$WORD_COUNT words", tooLong, problem, valid)
    }

    fun phraseFromCode(scanned: String): String? = scanned.takeIf { check(it).isValid }?.trim()

    fun footer(check: PhraseCheck): PhraseFooter = when {
        check.problem != null -> PhraseFooter(check.problem, PhraseFooter.Tone.PROBLEM)
        check.isValid -> PhraseFooter("All 24 words check out.", PhraseFooter.Tone.GOOD)
        else -> PhraseFooter(MAC_HINT, PhraseFooter.Tone.HINT)
    }

    fun message(problem: RecoveryPhrase.Problem): String = when (problem) {
        is RecoveryPhrase.Problem.WordCount -> "Recovery phrase must be exactly 24 words."
        is RecoveryPhrase.Problem.UnknownWord -> "“${problem.word}” is not a valid recovery phrase word."
        RecoveryPhrase.Problem.Checksum -> "This recovery phrase is not valid. Please check for typos."
    }
}

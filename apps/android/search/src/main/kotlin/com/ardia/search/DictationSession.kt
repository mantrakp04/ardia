package com.ardia.search

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

fun interface DictationRecorder {
    fun stop()
}

enum class DictationProblem { Language, Service, HeardNothing }

sealed interface DictationAccess {
    data object Granted : DictationAccess

    data object Denied : DictationAccess

    data class Unavailable(val problem: DictationProblem) : DictationAccess
}

class DictationEvents(
    val text: (String, Boolean) -> Unit,
    val level: (Float) -> Unit,
    val failure: (DictationProblem?) -> Unit,
)

@Stable
class DictationSession(
    private val scope: CoroutineScope,
    private val requestAccess: suspend () -> DictationAccess,
    private val startRecorder: (DictationEvents) -> DictationRecorder,
    private val silenceMillis: Long = SILENCE_TIMEOUT_MILLIS,
    private val firstWordsGraceMillis: Long = FIRST_WORDS_GRACE_MILLIS,
) {
    sealed interface State {
        data object Idle : State

        data object Requesting : State

        data object Listening : State

        data object Finished : State

        data object Denied : State

        data class Unavailable(val problem: DictationProblem) : State
    }

    var state: State by mutableStateOf(State.Idle)
        private set
    var transcript: String by mutableStateOf("")
        private set
    var level: Float by mutableFloatStateOf(0f)
        private set

    private var recorder: DictationRecorder? = null
    private var silenceJob: Job? = null
    private var attempt = 0

    suspend fun start() {
        if (state == State.Listening || state == State.Requesting) return
        attempt += 1
        val current = attempt
        state = State.Requesting
        val access = try {
            requestAccess()
        } catch (cancelled: CancellationException) {
            if (current == attempt && state == State.Requesting) state = State.Idle
            throw cancelled
        }
        if (current != attempt || state != State.Requesting) return
        if (!currentCoroutineContext().isActive) {
            state = State.Idle
            return
        }
        when (access) {
            DictationAccess.Denied -> {
                state = State.Denied
                return
            }
            is DictationAccess.Unavailable -> {
                state = State.Unavailable(access.problem)
                return
            }
            DictationAccess.Granted -> Unit
        }
        transcript = ""
        val events = DictationEvents(
            text = { text, isFinal -> if (current == attempt) received(text, isFinal) },
            level = { value -> if (current == attempt && state == State.Listening) level = value },
            failure = { problem -> if (current == attempt) failed(problem) },
        )
        recorder = try {
            startRecorder(events)
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            state = State.Unavailable(DictationProblem.Service)
            return
        }
        state = State.Listening
        scheduleSilence()
    }

    fun stop() {
        attempt += 1
        silenceJob?.cancel()
        silenceJob = null
        recorder?.stop()
        recorder = null
        level = 0f
        if (state == State.Listening) {
            state = if (transcript.isEmpty()) State.Unavailable(DictationProblem.HeardNothing) else State.Finished
        } else if (state == State.Requesting) {
            state = State.Idle
        }
    }

    private fun received(text: String, isFinal: Boolean) {
        if (state != State.Listening) return
        transcript = text
        if (isFinal) stop() else scheduleSilence()
    }

    private fun failed(problem: DictationProblem?) {
        if (state != State.Listening) return
        val keepsTranscript = transcript.isNotEmpty()
        stop()
        if (problem != null && !keepsTranscript) state = State.Unavailable(problem)
    }

    private fun scheduleSilence() {
        silenceJob?.cancel()
        val wait = silenceMillis + if (transcript.isEmpty()) firstWordsGraceMillis else 0L
        silenceJob = scope.launch {
            delay(wait)
            stop()
        }
    }

    companion object {
        const val SILENCE_TIMEOUT_MILLIS = 1_600L
        const val FIRST_WORDS_GRACE_MILLIS = 4_000L
    }
}

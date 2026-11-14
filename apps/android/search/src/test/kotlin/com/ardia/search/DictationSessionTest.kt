package com.ardia.search

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DictationSessionTest {
    private class Gate {
        var asked = 0
        private var waiting: CompletableDeferred<DictationAccess>? = null

        suspend fun request(): DictationAccess {
            asked += 1
            return CompletableDeferred<DictationAccess>().also { waiting = it }.await()
        }

        fun answer(access: DictationAccess) {
            waiting?.complete(access)
            waiting = null
        }
    }

    private class FakeRecorder : DictationRecorder {
        var stopped = false

        override fun stop() {
            stopped = true
        }
    }

    private class Log {
        val started = ArrayList<FakeRecorder>()
        var events: DictationEvents? = null
    }

    private fun TestScope.session(gate: Gate, log: Log) = DictationSession(
        scope = backgroundScope,
        requestAccess = { gate.request() },
        startRecorder = { events ->
            log.events = events
            FakeRecorder().also { log.started.add(it) }
        },
    )

    @Test
    fun dismissedWhileAskingForPermissionNeverStartsTheMicrophone() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val starting = launch { dictation.start() }
        runCurrent()
        assertEquals(DictationSession.State.Requesting, dictation.state)
        dictation.stop()
        gate.answer(DictationAccess.Granted)
        starting.join()
        assertTrue(log.started.isEmpty())
        assertEquals(DictationSession.State.Idle, dictation.state)
    }

    @Test
    fun aCancelledStartNeverStartsTheMicrophone() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val starting = launch { dictation.start() }
        runCurrent()
        starting.cancel()
        gate.answer(DictationAccess.Granted)
        starting.join()
        assertTrue(log.started.isEmpty())
        assertEquals(DictationSession.State.Idle, dictation.state)
    }

    @Test
    fun aStaleStartCannotHijackANewerOne() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val first = launch { dictation.start() }
        runCurrent()
        dictation.stop()
        gate.answer(DictationAccess.Granted)
        first.join()
        val second = launch { dictation.start() }
        runCurrent()
        assertEquals(2, gate.asked)
        gate.answer(DictationAccess.Granted)
        second.join()
        assertEquals(1, log.started.size)
        assertEquals(DictationSession.State.Listening, dictation.state)
        dictation.stop()
        assertTrue(log.started.first().stopped)
    }

    @Test
    fun grantedStartsListeningAndStopWithNothingHeardSaysSo() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val starting = launch { dictation.start() }
        runCurrent()
        gate.answer(DictationAccess.Granted)
        starting.join()
        assertEquals(DictationSession.State.Listening, dictation.state)
        dictation.stop()
        assertTrue(log.started.first().stopped)
        assertEquals(DictationSession.State.Unavailable(DictationProblem.HeardNothing), dictation.state)
    }

    @Test
    fun deniedNeverStartsTheMicrophone() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val starting = launch { dictation.start() }
        runCurrent()
        gate.answer(DictationAccess.Denied)
        starting.join()
        assertEquals(DictationSession.State.Denied, dictation.state)
        assertTrue(log.started.isEmpty())
    }

    @Test
    fun aFinalResultFinishesWithTheTranscript() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val starting = launch { dictation.start() }
        runCurrent()
        gate.answer(DictationAccess.Granted)
        starting.join()
        log.events!!.text("weather in lisbon", false)
        assertEquals("weather in lisbon", dictation.transcript)
        log.events!!.text("weather in lisbon today", true)
        assertEquals(DictationSession.State.Finished, dictation.state)
        assertEquals("weather in lisbon today", dictation.transcript)
        assertTrue(log.started.first().stopped)
    }

    @Test
    fun silenceAfterWordsStopsSoonerThanSilenceBeforeAnyWords() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val starting = launch { dictation.start() }
        runCurrent()
        gate.answer(DictationAccess.Granted)
        starting.join()
        advanceTimeBy(DictationSession.SILENCE_TIMEOUT_MILLIS + 100)
        assertEquals(DictationSession.State.Listening, dictation.state)
        log.events!!.text("hello", false)
        advanceTimeBy(DictationSession.SILENCE_TIMEOUT_MILLIS + 100)
        assertEquals(DictationSession.State.Finished, dictation.state)
    }

    @Test
    fun eventsFromAnEarlierRecorderAreIgnored() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val first = launch { dictation.start() }
        runCurrent()
        gate.answer(DictationAccess.Granted)
        first.join()
        val stale = log.events!!
        dictation.stop()
        val second = launch { dictation.start() }
        runCurrent()
        gate.answer(DictationAccess.Granted)
        second.join()
        stale.text("old words", true)
        assertEquals(DictationSession.State.Listening, dictation.state)
        assertEquals("", dictation.transcript)
    }

    @Test
    fun anUnsupportedLanguageSaysSoWhenNothingWasHeard() = runTest {
        val gate = Gate()
        val log = Log()
        val dictation = session(gate, log)
        val starting = launch { dictation.start() }
        runCurrent()
        gate.answer(DictationAccess.Granted)
        starting.join()
        log.events!!.failure(DictationProblem.Language)
        assertEquals(DictationSession.State.Unavailable(DictationProblem.Language), dictation.state)
    }

    @Test
    fun aRecorderThatFailsToStartLeavesDictationUnavailable() = runTest {
        val dictation = DictationSession(
            scope = backgroundScope,
            requestAccess = { DictationAccess.Granted },
            startRecorder = { throw IllegalStateException("busy") },
        )
        dictation.start()
        assertEquals(DictationSession.State.Unavailable(DictationProblem.Service), dictation.state)
    }

    @Test
    fun speechLevelsMapIntoZeroToOne() {
        assertEquals(0f, SpeechLevel.fromRms(-10f), 0f)
        assertEquals(0.5f, SpeechLevel.fromRms(4f), 0.0001f)
        assertEquals(1f, SpeechLevel.fromRms(20f), 0f)
    }
}

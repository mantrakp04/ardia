package com.ardia.search

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

class SpeechRecorder private constructor(private val recognizer: SpeechRecognizer, private val events: DictationEvents) :
    DictationRecorder,
    RecognitionListener {

    private var isStopped = false

    private fun begin() {
        recognizer.setRecognitionListener(this)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        recognizer.startListening(intent)
    }

    override fun stop() {
        if (isStopped) return
        isStopped = true
        recognizer.cancel()
        recognizer.destroy()
    }

    override fun onPartialResults(partialResults: Bundle?) {
        best(partialResults)?.let { events.text(it, false) }
    }

    override fun onResults(results: Bundle?) {
        val text = best(results)
        if (text != null) events.text(text, true) else events.failure(null)
    }

    override fun onRmsChanged(rmsdB: Float) {
        events.level(SpeechLevel.fromRms(rmsdB))
    }

    override fun onError(error: Int) {
        if (isStopped) return
        events.failure(SpeechLevel.problem(error))
    }

    override fun onReadyForSpeech(params: Bundle?) = Unit

    override fun onBeginningOfSpeech() = Unit

    override fun onBufferReceived(buffer: ByteArray?) = Unit

    override fun onEndOfSpeech() = Unit

    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    private fun best(bundle: Bundle?): String? =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }

    companion object {
        fun isAvailable(context: Context): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

        fun start(context: Context, events: DictationEvents): SpeechRecorder {
            val onDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
            val recognizer = if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
            return SpeechRecorder(recognizer, events).also { it.begin() }
        }
    }
}

object SpeechLevel {
    const val QUIET_RMS = -2f
    const val LOUD_RMS = 10f

    fun fromRms(rms: Float): Float = ((rms - QUIET_RMS) / (LOUD_RMS - QUIET_RMS)).coerceIn(0f, 1f)

    fun problem(error: Int): DictationProblem? = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) -> DictationProblem.Language
        error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS || error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ->
            DictationProblem.Service
        else -> null
    }
}

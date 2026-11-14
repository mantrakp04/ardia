package com.ardia.phone

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.ardia.search.DictationEvents
import com.ardia.search.SpeechRecorder
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SpeechModule : Module() {
    private var recorder: SpeechRecorder? = null
    private var session = 0

    @Volatile
    private var open = true

    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneSpeech")

        Events("onSpeech")

        OnDestroy {
            open = false
            android.os.Handler(android.os.Looper.getMainLooper()).post { stopRecording() }
        }

        AsyncFunction("isAvailable") { -> SpeechRecorder.isAvailable(context) }.runOnQueue(Queues.MAIN)

        AsyncFunction("requestAccess") { promise: Promise ->
            val available = SpeechRecorder.isAvailable(context)
            if (hasMicrophone()) {
                promise.resolve(SpeechPayloads.access(granted = true, available = available))
                return@AsyncFunction
            }
            val manager = appContext.permissions
            if (manager == null) {
                promise.resolve(SpeechPayloads.access(granted = false, available = available))
                return@AsyncFunction
            }
            manager.askForPermissions({ results ->
                val granted = results[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED
                promise.resolve(SpeechPayloads.access(granted = granted, available = available))
            }, Manifest.permission.RECORD_AUDIO)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("start") { id: Int ->
            stopRecording()
            if (!hasMicrophone()) throw CodedException("ERR_NO_MICROPHONE", "Ardia can't use the microphone", null)
            if (!SpeechRecorder.isAvailable(context)) throw CodedException("ERR_NO_RECOGNIZER", "Speech recognition isn't available on this phone", null)
            session = id
            recorder = SpeechRecorder.start(
                context,
                DictationEvents(
                    text = { text, isFinal -> send(id, SpeechPayloads.text(id, text, isFinal)) },
                    level = { level -> send(id, SpeechPayloads.level(id, level)) },
                    failure = { problem -> send(id, SpeechPayloads.failure(id, problem)) },
                ),
            )
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("stop") { -> stopRecording() }.runOnQueue(Queues.MAIN)
    }

    private fun send(id: Int, event: Map<String, Any?>) {
        if (!open || id != session || recorder == null) return
        runCatching { sendEvent("onSpeech", event) }
    }

    private fun stopRecording() {
        recorder?.stop()
        recorder = null
    }

    private fun hasMicrophone(): Boolean = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
}

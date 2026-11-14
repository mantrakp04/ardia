package com.ardia.phone

import com.ardia.search.DictationProblem

object SpeechPayloads {
    fun text(session: Int, text: String, isFinal: Boolean): Map<String, Any?> = mapOf("type" to "text", "session" to session, "text" to text, "isFinal" to isFinal)

    fun level(session: Int, level: Float): Map<String, Any?> = mapOf("type" to "level", "session" to session, "level" to level.toDouble())

    fun failure(session: Int, problem: DictationProblem?): Map<String, Any?> = mapOf(
        "type" to "failure",
        "session" to session,
        "problem" to when (problem) {
            DictationProblem.Language -> "language"
            DictationProblem.Service -> "service"
            DictationProblem.HeardNothing, null -> null
        },
    )

    fun access(granted: Boolean, available: Boolean): String = when {
        !available -> "unavailable"
        granted -> "granted"
        else -> "denied"
    }
}

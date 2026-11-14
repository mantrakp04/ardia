package com.ardia.search

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

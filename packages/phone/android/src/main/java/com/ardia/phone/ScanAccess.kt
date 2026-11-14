package com.ardia.phone

object ScanAccess {
    data class Answer(val status: String, val canAskAgain: Boolean)

    fun status(granted: Boolean, rationale: Boolean, deniedForGood: Boolean): Answer = when {
        granted -> Answer("granted", true)
        rationale -> Answer("denied", true)
        deniedForGood -> Answer("denied", false)
        else -> Answer("undetermined", true)
    }

    fun deniedForGoodAfterAsking(granted: Boolean, rationale: Boolean): Boolean = !granted && !rationale
}

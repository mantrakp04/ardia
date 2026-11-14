package com.ardia.phone

import com.ardia.settings.ScanVerdict

object ScanPayloads {
    data class Event(val name: String, val body: Map<String, Any>)

    fun event(verdict: ScanVerdict): Event? = when (verdict) {
        is ScanVerdict.Accept -> Event("onCode", mapOf("text" to verdict.phrase))
        ScanVerdict.Reject -> Event("onRejected", emptyMap())
        ScanVerdict.Repeat -> null
    }
}

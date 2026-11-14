package com.ardia.phone

import expo.modules.kotlin.exception.CodedException

internal object SyncFailure {
    const val STORE_MESSAGE = "Sync couldn't finish with that folder."

    fun forScript(error: Throwable, lab: Boolean = PhoneLab.isOn): CodedException =
        if (lab) CodedException("ERR_SYNC", error.message, error) else CodedException("ERR_SYNC", STORE_MESSAGE, null)
}

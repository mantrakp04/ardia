package com.ardia.phone

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ClipboardModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneClipboard")

        AsyncFunction("offer") { ->
            val context = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)
            ClipboardPayloads.offer(context)
        }
    }
}

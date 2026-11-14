package com.ardia.phone

import com.ardia.design.FaviconTone

object FaviconPayloads {
    fun tone(tone: FaviconTone): String = when (tone) {
        FaviconTone.Opaque -> "opaque"
        FaviconTone.DarkOnClear -> "darkOnClear"
        FaviconTone.LightOnClear -> "lightOnClear"
        FaviconTone.Mixed -> "mixed"
        FaviconTone.Blank -> "blank"
    }

    fun look(tone: FaviconTone, dark: Boolean): Map<String, Any?> = mapOf(
        "tone" to tone(tone),
        "backing" to when {
            tone == FaviconTone.DarkOnClear && dark -> "light"
            tone == FaviconTone.LightOnClear && !dark -> "dark"
            else -> null
        },
    )
}

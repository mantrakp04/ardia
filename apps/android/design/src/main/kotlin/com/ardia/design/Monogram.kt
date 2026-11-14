package com.ardia.design

import java.net.URI

object Monogram {
    private val palette = longArrayOf(0x5E6AD2, 0x2F9E8F, 0xD9663F, 0x8A5CC7, 0x3A8DDE, 0xC2477A, 0x5F9E3A, 0xB8862B)
    private const val NEUTRAL = 0x8E8E93L

    fun host(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val host = runCatching { URI(url.trim()).host }.getOrNull()?.lowercase() ?: return null
        if (host.isEmpty()) return null
        return if (host.startsWith("www.")) host.drop(4) else host
    }

    fun letter(host: String?): String? {
        if (host == null) return null
        var index = 0
        while (index < host.length) {
            val codePoint = host.codePointAt(index)
            if (Character.isLetterOrDigit(codePoint)) return String(Character.toChars(codePoint)).uppercase()
            index += Character.charCount(codePoint)
        }
        return null
    }

    fun hash(host: String): UInt {
        var hash = 5381u
        var index = 0
        while (index < host.length) {
            val codePoint = host.codePointAt(index)
            hash = hash * 33u + codePoint.toUInt()
            index += Character.charCount(codePoint)
        }
        return hash
    }

    fun tintHex(host: String?): Long {
        if (host == null) return NEUTRAL
        return palette[(hash(host) % palette.size.toUInt()).toInt()]
    }
}

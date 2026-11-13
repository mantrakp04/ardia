package com.ardia.blocking

import java.util.concurrent.ConcurrentHashMap

object BlockingScripts {
    val consent: String by lazy {
        val stream = BlockingScripts::class.java.getResourceAsStream("/com/ardia/blocking/consent.js")
        stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
    }

    private val hidingScripts = ConcurrentHashMap<String, String>()

    fun hiding(css: String): String {
        if (css.isEmpty()) return ""
        if (css.length < CACHE_THRESHOLD) return build(css)
        return hidingScripts.getOrPut(css) {
            if (hidingScripts.size > 16) hidingScripts.clear()
            build(css)
        }
    }

    private fun build(css: String): String {
        val literal = jsString(css)
        return "(() => {\n" +
            "  const css = $literal;\n" +
            "  try {\n" +
            "    const sheet = new CSSStyleSheet();\n" +
            "    sheet.replaceSync(css);\n" +
            "    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];\n" +
            "  } catch (e) {\n" +
            "    const add = () => {\n" +
            "      const style = document.createElement(\"style\");\n" +
            "      style.textContent = css;\n" +
            "      (document.head || document.documentElement).appendChild(style);\n" +
            "    };\n" +
            "    if (document.documentElement) add(); else document.addEventListener(\"readystatechange\", add, { once: true });\n" +
            "  }\n" +
            "})();\n"
    }

    internal fun jsString(text: String): String {
        val out = StringBuilder(text.length + 16)
        out.append('"')
        for (char in text) {
            when (char) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                ' ' -> out.append("\\u2028")
                ' ' -> out.append("\\u2029")
                '<' -> out.append("\\x3c")
                else -> if (char.code < 0x20) out.append("\\u%04x".format(char.code)) else out.append(char)
            }
        }
        out.append('"')
        return out.toString()
    }

    private const val CACHE_THRESHOLD = 4096
}

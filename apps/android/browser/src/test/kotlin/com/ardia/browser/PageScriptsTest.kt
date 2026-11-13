package com.ardia.browser

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PageScriptsTest {
    private val iphoneWeb = File("../../ios/Packages/ArdiaKit/Sources/ArdiaBrowser/Web")
    private val assets = File("src/main/assets/ardia-browser")

    private fun swiftScript(file: String, marker: String): List<String> {
        val source = File(iphoneWeb, file).readText()
        val start = source.indexOf('\n', source.indexOf(marker)) + 1
        val end = source.indexOf("\"\"\"#", start)
        return source.substring(start, end).trimEnd(' ').removeSuffix("\n").split('\n').map { it.removePrefix("  ") }
    }

    @Test
    fun readerScriptIsTheIphoneScript() {
        val iphone = swiftScript("ReadableContent.swift", "static let script = #\"\"\"")
        assertEquals(iphone, File(assets, "readable-content.js").readText().removeSuffix("\n").split('\n'))
    }

    @Test
    fun nightShadeScriptDiffersFromTheIphoneOnlyInItsBridge() {
        val iphone = swiftScript("NightShade.swift", "static let nightShade = #\"\"\"")
        val android = File(assets, "night-shade.js").readText().removeSuffix("\n").split('\n')
        assertEquals(iphone.size, android.size)
        val different = iphone.indices.filter { iphone[it] != android[it] }
        assertEquals(1, different.size)
        assertTrue(iphone[different[0]].contains("window.webkit.messageHandlers.ardiaPage"))
        assertTrue(android[different[0]].contains("window.${PageScripts.BRIDGE_NAME}"))
        assertTrue(android[different[0]].contains("\"${PageScripts.NIGHT_SHADE_MESSAGE}\""))
    }

    @Test
    fun noFilterScriptsInstallsNothing() {
        assertNull(PageScripts.filterBundle(emptyList(), emptyList()))
    }

    @Test
    fun filterScriptsRunInTheMainFrameEachIsolatedFromTheOthersFailures() {
        val bundle = PageScripts.filterBundle(listOf("first()", "second()"), emptyList())!!
        assertTrue(bundle.startsWith("(() => {\nif (window !== window.top) return;"))
        assertEquals(2, Regex("try \\{").findAll(bundle).count())
        assertTrue(bundle.indexOf("first()") < bundle.indexOf("second()"))
        assertTrue(!bundle.contains("DOMContentLoaded"))
    }

    @Test
    fun documentEndScriptsWaitForDomContentLoaded() {
        val bundle = PageScripts.filterBundle(listOf("early()"), listOf("late()"))!!
        val listener = bundle.indexOf("DOMContentLoaded")
        assertTrue(bundle.indexOf("early()") < bundle.indexOf("runAtDocumentEnd"))
        assertTrue(bundle.indexOf("late()") in bundle.indexOf("runAtDocumentEnd")..listener)
        assertTrue(bundle.contains("else runAtDocumentEnd();"))
    }

    @Test
    fun nightShadeCallNamesTheMode() {
        assertEquals("window.__ardiaNightShade && window.__ardiaNightShade(\"always\")", PageScripts.nightShadeCall(NightShadeMode.Always))
        assertTrue(PageScripts.mainFrameOnly("x()").startsWith("if (window === window.top) {"))
    }
}

package com.ardia.settings

import com.ardia.appmodel.SettingsRoute
import com.ardia.store.SearchEngineInfo
import com.ardia.sync.SyncedDevice
import com.ardia.sync.SyncedSearch
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsLogicTest {
    private val validPhrase = (List(23) { "abandon" } + "art").joinToString(" ")

    @Test
    fun backStackPushesPopsAndIgnoresARepeatedPush() {
        val stack = SettingsBackStack()
        assertTrue(stack.isAtRoot)
        stack.push(SettingsRoute.SiteSettings)
        stack.push(SettingsRoute.SiteSettings)
        stack.push(SettingsRoute.FilterLists)
        assertEquals(2, stack.entries.size)
        assertTrue(stack.pop())
        assertEquals(SettingsDestination.Page(SettingsRoute.SiteSettings), stack.top)
        assertTrue(stack.pop())
        assertFalse(stack.pop())
    }

    @Test
    fun aPendingRouteReplacesTheStackAndTheDetailRouteOpensTheDefaultList() {
        val stack = SettingsBackStack(listOf(SettingsDestination.Page(SettingsRoute.About)))
        assertFalse(stack.takePending(null))
        assertTrue(stack.takePending(SettingsRoute.FilterListDetail))
        assertEquals(listOf(SettingsDestination.FilterList(SettingsDestination.DEFAULT_FILTER_LIST)), stack.entries)
    }

    @Test
    fun popToKeepsTheMatchingPage() {
        val stack = SettingsBackStack()
        stack.push(SettingsRoute.Sync)
        stack.push(SettingsRoute.Connect)
        stack.push(SettingsDestination.EnterWords)
        stack.popTo { it == SettingsDestination.Page(SettingsRoute.Sync) }
        assertEquals(listOf(SettingsDestination.Page(SettingsRoute.Sync)), stack.entries)
        assertTrue(stack.isPopping)
    }

    @Test
    fun searchEngineNamesPreferTheMacsCustomEngineThenTheCatalog() {
        val custom = SyncedSearch("mine", customEngines = listOf(SyncedSearch.CustomEngine("mine", "My Search", "m", "https://m.example/?q=%s")))
        assertEquals("My Search", SearchEngineNames.name(custom, "Custom"))
        assertEquals("Custom", SearchEngineNames.name(SyncedSearch("custom"), "Custom"))
        assertEquals("DuckDuckGo", SearchEngineNames.name("duckduckgo"))
        assertEquals("Mojeek", SearchEngineNames.name("mojeek"))
        assertEquals("Google", SearchEngineNames.current(syncEnabled = true, synced = SyncedSearch("google"), localId = "bing", customTitle = "Custom"))
        assertEquals("Bing", SearchEngineNames.current(syncEnabled = false, synced = SyncedSearch("google"), localId = "bing", customTitle = "Custom"))
    }

    @Test
    fun loadedEnginesDropCustomOnesAndFallBackWhenEmpty() {
        val loaded = listOf(SearchEngineInfo("google", "Google", "https://g/?q=%s"), SearchEngineInfo("x", "Mine", "https://x/?q=%s", custom = true))
        assertEquals(listOf(EngineChoice("google", "Google")), SearchEngineNames.choices(loaded))
        assertEquals(SearchEngineNames.fallback, SearchEngineNames.choices(emptyList()))
    }

    @Test
    fun theScanJudgeAcceptsAPhraseOnceRejectsOtherCodesAndIgnoresRepeats() {
        val judge = SyncCodeJudge()
        assertEquals(ScanVerdict.Reject, judge.judge("https://example.com"))
        assertEquals(ScanVerdict.Repeat, judge.judge("https://example.com"))
        assertEquals(ScanVerdict.Accept(validPhrase), judge.judge("  $validPhrase\n"))
        assertEquals(ScanVerdict.Repeat, judge.judge("  $validPhrase\n"))
    }

    @Test
    fun theDecoderReadsAQrCodeItsWriterMade() {
        val matrix = QRCodeWriter().encode(validPhrase, BarcodeFormat.QR_CODE, 300, 300)
        val pixels = ByteArray(matrix.width * matrix.height) { index ->
            if (matrix[index % matrix.width, index / matrix.width]) 0 else 255.toByte()
        }
        assertEquals(validPhrase, QrDecoder().decode(pixels, matrix.width, matrix.height, matrix.width))
        assertNull(QrDecoder().decode(ByteArray(100 * 100) { 127 }, 100, 100, 100))
    }

    @Test
    fun theSketchCodeIsASquareQrCode() {
        val matrix = SketchQr.matrix
        assertEquals(matrix.width, matrix.height)
        assertTrue(matrix.width >= 21)
    }

    @Test
    fun folderNamesComeFromTheTreeDocumentId() {
        assertEquals("Ardia Sync", FolderNames.fromTreeDocumentId("primary:Documents/Ardia Sync", "Fallback"))
        assertEquals("Ardia Sync", FolderNames.fromTreeDocumentId("primary:Ardia Sync/", "Fallback"))
        assertEquals("Fallback", FolderNames.fromTreeDocumentId("primary:", "Fallback"))
        assertEquals("Fallback", FolderNames.fromTreeDocumentId(null, "Fallback"))
    }

    @Test
    fun onboardingWalksEveryStepIncludingTheDefaultBrowser() {
        val walked = generateSequence(OnboardingStep.Welcome) { it.next }.toList()
        assertEquals(listOf(OnboardingStep.Welcome, OnboardingStep.Blocking, OnboardingStep.DefaultBrowser, OnboardingStep.Sync, OnboardingStep.AllSet), walked)
        assertTrue(OnboardingStep.AllSet.isLast)
    }

    @Test
    fun devicesListOthersByLastSeenAndThisPhoneLast() {
        val phone = SyncedDevice("p", "Pixel", SyncedDevice.PHONE, 9_000.0, isCurrent = true, canReceiveTabs = false)
        val old = SyncedDevice("o", "iMac", SyncedDevice.MAC, 1_000.0, isCurrent = false, canReceiveTabs = true)
        val recent = SyncedDevice("r", "MacBook Pro", SyncedDevice.MAC, 5_000.0, isCurrent = false, canReceiveTabs = true)
        val never = SyncedDevice("n", "Mac mini", SyncedDevice.MAC, null, isCurrent = false, canReceiveTabs = true)
        assertEquals(listOf("r", "o", "n", "p"), SyncDeviceWords.ordered(listOf(phone, old, never, recent)).map { it.id })
    }
}

package com.ardia.browser.android

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import com.ardia.browser.android.share.ShareActivity
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccessibilityReachTest {
    private var session: AppSession? = null

    @Before
    fun setUp() {
        AppTest.freshModel()
    }

    @After
    fun tearDown() {
        session?.close()
        AppTest.freshModel()
    }

    @Test
    fun onboardingsButtonsAreInTheAccessibilityTree() {
        session = AppTest.launch(mapOf(LaunchArguments.ARDIA_ONBOARDING to true))
        AppTest.waitUntil("onboarding on screen") { AppTest.model.settings.isShowingOnboarding }
        expectTapped("Get Started")
        expectReachable("Continue")
    }

    @Test
    fun theShareSheetsRowsAreInTheAccessibilityTree() {
        session = AppTest.launch()
        AppTest.start(Intent(AppTest.context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://example.com/"))
        expectReachable("Open in Ardia")
    }

    @Test
    fun theOnboardingCoverHidesTheStartScreenBehindIt() {
        session = AppTest.launch(mapOf(LaunchArguments.ARDIA_ONBOARDING to true))
        AppTest.waitUntil("onboarding on screen") { AppTest.model.settings.isShowingOnboarding }
        expectReachable("Get Started")
        expectHidden(START_SCREEN_LABELS)
    }

    @Test
    fun anOpenSheetHidesTheScreenBehindItUntilItCloses() {
        session = AppTest.launch(mapOf(LaunchArguments.ARDIA_RESTING_START to true))
        AppTest.waitUntil("the start screen") { !AppTest.model.settings.isShowingOnboarding && AppTest.model.surface == AppModel.Surface.Search }
        expectLabelled(START_SCREEN_LABELS)
        AppTest.onMain { AppTest.model.sheet = AppModel.Sheet.Settings }
        expectReachable("Done")
        expectHidden(START_SCREEN_LABELS)
        AppTest.onMain { AppTest.model.sheet = null }
        expectLabelled(START_SCREEN_LABELS)
    }

    private fun expectLabelled(labels: List<String>, timeoutMillis: Long = 30_000) {
        val end = System.currentTimeMillis() + timeoutMillis
        while (true) {
            val seen = AppTest.accessibilityLabels()
            if (labels.all { it in seen }) return
            if (System.currentTimeMillis() > end) fail("expected ${labels - seen.toSet()} in the accessibility tree; labels seen: ${seen.take(40)}")
            Thread.sleep(250)
        }
    }

    private fun expectHidden(labels: List<String>, settleMillis: Long = 1_500) {
        AppTest.settledScreenshot(timeoutMillis = 4_000)
        val end = System.currentTimeMillis() + settleMillis
        var seen = AppTest.accessibilityLabels()
        while (labels.any { it in seen } && System.currentTimeMillis() < end) {
            Thread.sleep(250)
            seen = AppTest.accessibilityLabels()
        }
        val exposed = labels.filter { it in seen }
        assertTrue("covered controls $exposed are still in the accessibility tree; labels seen: ${seen.take(40)}", exposed.isEmpty())
    }

    private fun expectReachable(text: String, timeoutMillis: Long = 30_000) = expectThroughAccessibility(text, timeoutMillis) { AppTest.findThroughAccessibility(text) != null }

    private fun expectTapped(text: String, timeoutMillis: Long = 30_000) = expectThroughAccessibility(text, timeoutMillis) { AppTest.tapThroughAccessibility(text) }

    private fun expectThroughAccessibility(text: String, timeoutMillis: Long, found: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMillis
        while (!found()) {
            if (System.currentTimeMillis() > end) {
                val semantics = if (AppTest.inSemantics(text)) "it is in Compose semantics" else "it is not in Compose semantics either"
                fail("\"$text\" is not reachable through the accessibility tree ($semantics); labels seen: ${AppTest.accessibilityLabels().take(40)}")
            }
            Thread.sleep(250)
        }
        AppTest.settledScreenshot(timeoutMillis = 4_000)
    }

    private companion object {
        val START_SCREEN_LABELS = listOf("Tabs", "New Tab")
    }
}

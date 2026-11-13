package com.ardia.browser.android

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.appmodel.LaunchArguments
import com.ardia.browser.android.share.ShareActivity
import org.junit.After
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
        expectReachable("Get Started")
        expectReachable("Continue")
    }

    @Test
    fun theShareSheetsRowsAreInTheAccessibilityTree() {
        session = AppTest.launch()
        AppTest.start(Intent(AppTest.context, ShareActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://example.com/"))
        expectReachable("Open in Ardia")
    }

    private fun expectReachable(text: String, timeoutMillis: Long = 30_000) {
        val end = System.currentTimeMillis() + timeoutMillis
        while (!AppTest.tapThroughAccessibility(text)) {
            if (System.currentTimeMillis() > end) {
                val semantics = if (AppTest.tapThroughSemantics(text)) "it is in Compose semantics" else "it is not in Compose semantics either"
                fail("\"$text\" is not reachable through the accessibility tree ($semantics); labels seen: ${AppTest.accessibilityLabels().take(40)}")
            }
            Thread.sleep(250)
        }
        AppTest.settledScreenshot(timeoutMillis = 4_000)
    }
}

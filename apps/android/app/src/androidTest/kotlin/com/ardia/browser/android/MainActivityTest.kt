package com.ardia.browser.android

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    private fun webView(view: View): WebView? = when (view) {
        is WebView -> view
        is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { webView(view.getChildAt(it)) }
        else -> null
    }

    @Test
    fun theScreenLoadsATypedAddressThroughThePageEngine() {
        val address = InstrumentationRegistry.getArguments().getString("ardiaAddress") ?: "localhost:8765/hello.html"
        val intent = Intent(InstrumentationRegistry.getInstrumentation().targetContext, MainActivity::class.java).putExtra(MainActivity.EXTRA_URL, address)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            var title: String? = null
            var url: String? = null
            val deadline = System.currentTimeMillis() + 30_000
            while (System.currentTimeMillis() < deadline && title != "Ardia test page") {
                scenario.onActivity { activity ->
                    val page = webView(activity.window.decorView)
                    title = page?.title
                    url = page?.url
                }
                Thread.sleep(250)
            }
            assertEquals("http://localhost:8765/hello.html", url)
            assertEquals("Ardia test page", title)
        }
    }
}

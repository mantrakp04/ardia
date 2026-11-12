package com.ardia.appmodel

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.ardia.store.TabOrigin
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppModelDeviceTest {
    private lateinit var app: AppModel
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Before
    fun setUp() {
        instrumentation.runOnMainSync {
            app = AppModel(LaunchArguments(isDemo = true), AppEnvironment.forApp(ApplicationProvider.getApplicationContext(), isDemo = true))
        }
        waitFor { app.isReady }
    }

    @After
    fun tearDown() {
        instrumentation.runOnMainSync { app.close() }
    }

    private fun <T> onMain(work: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(work) }
        return result!!.getOrThrow()
    }

    private fun waitFor(timeoutMillis: Long = 20_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMillis
        while (!onMain(condition)) {
            if (System.currentTimeMillis() > end) fail("condition not met within $timeoutMillis ms")
            Thread.sleep(50)
        }
    }

    @Test
    fun theOmniboxRunsInHermesAndKnowsTheSearchEngines() {
        val engines = runBlocking { app.searchEngines() }
        assertTrue(engines.any { it.id == "google" })
    }

    @Test
    fun aRealPageReportsItsTitleToTheTab() {
        onMain { app.openPage("data:text/html,<title>Device Title</title><p>hi", TabOrigin.TYPED) }
        waitFor { app.currentPage != null }
        waitFor { app.tabs.selectedTab?.title == "Device Title" }
    }
}

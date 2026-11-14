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
    fun aTypedUrlLoadedByTheRealEngineLandsInHistory() {
        val server = java.net.ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
        kotlin.concurrent.thread(isDaemon = true) {
            while (!server.isClosed) {
                val client = runCatching { server.accept() }.getOrNull() ?: break
                kotlin.concurrent.thread(isDaemon = true) {
                    client.use { socket ->
                        val reader = socket.getInputStream().bufferedReader()
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val body = "<html><head><title>Served Page</title></head><body>hello</body></html>".toByteArray()
                        val head = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                        socket.getOutputStream().apply {
                            write(head.toByteArray())
                            write(body)
                            flush()
                        }
                    }
                }
            }
        }
        try {
            val url = "http://127.0.0.1:${server.localPort}/typed"
            onMain { app.openPage(url, TabOrigin.TYPED) }
            waitFor { app.tabs.selectedTab?.title == "Served Page" }
            val deadline = System.currentTimeMillis() + 20_000
            while (runBlocking { app.awaitReady().history.recent() }.none { it.url == url }) {
                if (System.currentTimeMillis() > deadline) fail("the typed URL never reached history")
                Thread.sleep(100)
            }
        } finally {
            server.close()
        }
    }

    @Test
    fun aRealPageReportsItsTitleToTheTab() {
        onMain { app.openPage("data:text/html,<title>Device Title</title><p>hi", TabOrigin.TYPED) }
        waitFor { app.currentPage != null }
        waitFor { app.tabs.selectedTab?.title == "Device Title" }
    }
}

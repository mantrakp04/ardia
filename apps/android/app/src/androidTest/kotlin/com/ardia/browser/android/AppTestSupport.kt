package com.ardia.browser.android

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.services.storage.TestStorage
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import org.junit.Assert.fail

object AppTest {
    val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    val context: Context get() = ApplicationProvider.getApplicationContext()
    val app: ArdiaApplication get() = ArdiaApplication.of(context)

    fun <T> onMain(work: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(work) }
        return result!!.getOrThrow()
    }

    fun waitUntil(what: String, timeoutMillis: Long = 20_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMillis
        while (!onMain(condition)) {
            if (System.currentTimeMillis() > end) fail("$what was not reached within $timeoutMillis ms")
            Thread.sleep(50)
        }
    }

    fun freshModel() = onMain { app.discardModel() }

    val model: AppModel get() = onMain { app.existingModel } ?: error("no app model yet")

    fun launch(arguments: Map<String, Any> = emptyMap(), demo: Boolean = true): ActivityScenario<MainActivity> {
        val intent = Intent(context, MainActivity::class.java)
        if (demo) intent.putExtra(LaunchArguments.ARDIA_DEMO, true)
        for ((key, value) in arguments) {
            when (value) {
                is Boolean -> intent.putExtra(key, value)
                is Int -> intent.putExtra(key, value)
                is Double -> intent.putExtra(key, value)
                else -> intent.putExtra(key, value.toString())
            }
        }
        val scenario = ActivityScenario.launch<MainActivity>(intent)
        waitUntil("the app model's store") { app.existingModel?.isReady == true }
        return scenario
    }

    fun shell(command: String): String {
        val descriptor = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { stream ->
            BufferedReader(InputStreamReader(stream)).readText()
        }
    }

    fun setNight(night: Boolean) {
        shell("cmd uimode night ${if (night) "yes" else "no"}")
        instrumentation.waitForIdleSync()
    }

    fun settledScreenshot(timeoutMillis: Long = 6_000, stableFrames: Int = 2): Bitmap {
        instrumentation.waitForIdleSync()
        val end = System.currentTimeMillis() + timeoutMillis
        var previous: Bitmap? = null
        var stable = 0
        while (true) {
            val current = instrumentation.uiAutomation.takeScreenshot() ?: error("the screen could not be captured")
            if (previous != null && current.sameAs(previous)) stable++ else stable = 0
            previous?.recycle()
            previous = current
            if (stable >= stableFrames || System.currentTimeMillis() > end) return current
            Thread.sleep(SETTLE_STEP_MILLIS)
            instrumentation.waitForIdleSync()
        }
    }

    fun save(bitmap: Bitmap, fileName: String) {
        TestStorage().openOutputFile(fileName).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
    }

    const val SETTLE_STEP_MILLIS = 300L
}

class TourServer : AutoCloseable {
    private val socket = ServerSocket(0)
    private val workers = Executors.newCachedThreadPool()
    val port: Int get() = socket.localPort

    init {
        workers.execute {
            while (!socket.isClosed) {
                val client = runCatching { socket.accept() }.getOrNull() ?: break
                workers.execute { serve(client) }
            }
        }
    }

    fun url(path: String): String = "http://127.0.0.1:$port$path"

    private fun serve(client: Socket) {
        client.use {
            val reader = BufferedReader(InputStreamReader(it.getInputStream()))
            val request = reader.readLine() ?: return
            while (reader.readLine()?.isNotEmpty() == true) Unit
            val path = request.split(' ').getOrNull(1)?.substringBefore('?') ?: "/"
            val (type, body) = when (path) {
                "/picture.svg" -> "image/svg+xml" to PICTURE
                "/favicon.ico" -> "text/plain" to ""
                else -> "text/html; charset=utf-8" to ARTICLE
            }
            val bytes = body.toByteArray(Charsets.UTF_8)
            val status = if (path == "/favicon.ico") "404 Not Found" else "200 OK"
            val head = "HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
            it.getOutputStream().apply {
                write(head.toByteArray(Charsets.US_ASCII))
                write(bytes)
                flush()
            }
        }
    }

    override fun close() {
        socket.close()
        workers.shutdownNow()
    }

    companion object {
        const val TITLE = "Lisbon, the city of seven hills"

        val PICTURE = """
            <svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320">
              <rect width="640" height="320" fill="#F9F5E3"/>
              <circle cx="470" cy="110" r="60" fill="#F5A812"/>
              <path d="M0 260 C160 170 320 150 640 210 L640 320 L0 320 Z" fill="#17604B"/>
            </svg>
        """.trimIndent()

        val ARTICLE = """
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <meta name="theme-color" content="#17604B">
              <title>$TITLE</title>
              <style>
                body { font-family: Georgia, serif; margin: 0; color: #1b1b1b; background: #fffdf6; }
                header { background: #17604B; color: white; padding: 28px 20px; }
                main { padding: 8px 20px 60px; line-height: 1.55; font-size: 18px; }
                img { width: 100%; border-radius: 12px; }
              </style>
            </head>
            <body>
              <header><h1>$TITLE</h1><p>A walk through Alfama, Baixa and Belém</p></header>
              <main>
                <article>
                  <img src="/picture.svg" alt="Hills over the river">
                  <p>Lisbon sits on seven hills above the Tagus. Trams climb streets so steep that the rails seem to lean, and every corner opens onto another view of red roofs and the wide river below.</p>
                  <p>Start in Alfama, the oldest quarter, where lanes twist between tiled houses and the smell of grilled sardines drifts out of small kitchens. Fado drifts out of doorways in the evening.</p>
                  <p>Walk down to Baixa, rebuilt in a grid after the earthquake of 1755, then cross the great square of Comércio to the water. From there the tram runs west to Belém, home of the tower and the custard tarts that started a thousand imitations.</p>
                  <p>Lisbon rewards slow days: a coffee at a kiosk, a climb to a miradouro at sunset, and tapas that turn into dinner without anyone noticing.</p>
                  <p>Search this page for Lisbon to see find on page at work, or open it in Reader for a calmer read.</p>
                </article>
              </main>
            </body>
            </html>
        """.trimIndent()
    }
}

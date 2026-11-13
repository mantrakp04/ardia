package com.ardia.browser.android

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.services.storage.TestStorage
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.LaunchArguments
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import org.junit.Assert.fail

object AppTest {
    const val TAG = "ArdiaTour"
    const val READY_TIMEOUT_MILLIS = 120_000L
    const val ACTIVITY_TIMEOUT_MILLIS = 60_000L
    const val SETTLE_STEP_MILLIS = 400L
    const val SETTLE_AFTER_DIALOG_MILLIS = 3_000L

    val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    val context: Context get() = ApplicationProvider.getApplicationContext()
    val app: ArdiaApplication get() = ArdiaApplication.of(context)

    fun <T> onMain(work: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return work()
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(work) }
        return result!!.getOrThrow()
    }

    fun waitUntil(what: String, timeoutMillis: Long = 30_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMillis
        while (!onMain(condition)) {
            if (System.currentTimeMillis() > end) fail("$what was not reached within $timeoutMillis ms")
            Thread.sleep(100)
        }
    }

    val model: AppModel get() = app.existingModel ?: error("no app model yet")

    fun freshModel() {
        finishAll()
        leaveNoSystemScreenOnTop()
        onMain { app.discardModel() }
    }

    fun activities(stage: Stage): List<Activity> = onMain { ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage).toList() }

    fun liveActivities(): List<Activity> = listOf(Stage.PRE_ON_CREATE, Stage.CREATED, Stage.STARTED, Stage.RESUMED, Stage.PAUSED, Stage.STOPPED, Stage.RESTARTED)
        .flatMap(::activities)
        .distinct()

    fun finishAll() {
        val live = liveActivities()
        if (live.isEmpty()) return
        onMain { live.forEach(Activity::finish) }
        waitUntil("every test activity finishing", ACTIVITY_TIMEOUT_MILLIS) { liveActivities().none { it in live } }
    }

    fun launch(arguments: Map<String, Any> = emptyMap(), demo: Boolean = true): AppSession {
        finishAll()
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        if (demo) intent.putExtra(LaunchArguments.ARDIA_DEMO, true)
        for ((key, value) in arguments) {
            when (value) {
                is Boolean -> intent.putExtra(key, value)
                is Int -> intent.putExtra(key, value)
                is Double -> intent.putExtra(key, value)
                else -> intent.putExtra(key, value.toString())
            }
        }
        context.startActivity(intent)
        var activity: MainActivity? = null
        waitUntil("MainActivity in front", ACTIVITY_TIMEOUT_MILLIS) {
            activity = activities(Stage.RESUMED).filterIsInstance<MainActivity>().firstOrNull()
            activity != null
        }
        waitUntil("the app model's store", READY_TIMEOUT_MILLIS) { app.existingModel?.isReady == true }
        return AppSession(activity!!)
    }

    fun start(intent: Intent) {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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

    fun tap(text: String, timeoutMillis: Long = 30_000): Boolean {
        val end = System.currentTimeMillis() + timeoutMillis
        val accessibilityEnd = System.currentTimeMillis() + timeoutMillis / 2
        while (true) {
            if (tapThroughAccessibility(text)) return true
            if (System.currentTimeMillis() > accessibilityEnd && tapThroughSemantics(text)) {
                Log.w(TAG, "\"$text\" is reachable only through Compose semantics, not the accessibility tree")
                return false
            }
            if (System.currentTimeMillis() > end) {
                fail("nothing labelled \"$text\" could be tapped within $timeoutMillis ms; accessibility labels: ${accessibilityLabels().take(40)}")
            }
            Thread.sleep(250)
        }
    }

    fun findThroughAccessibility(text: String): AccessibilityNodeInfo? {
        clearSystemDialogs()
        return accessibilityRoots().firstNotNullOfOrNull { findClickable(it, text, null) }
    }

    fun tapThroughAccessibility(text: String): Boolean = findThroughAccessibility(text)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true

    private fun windows(): List<AccessibilityWindowInfo> {
        val automation = instrumentation.uiAutomation
        val info = automation.serviceInfo
        if (info != null && info.flags and AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS == 0) {
            info.flags = info.flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            automation.serviceInfo = info
        }
        return runCatching { automation.windows.toList() }.getOrDefault(emptyList())
    }

    private fun isOurs(root: AccessibilityNodeInfo?): Boolean = root?.packageName?.toString() == context.packageName

    private fun accessibilityRoots(): List<AccessibilityNodeInfo> {
        val roots = windows().mapNotNull { it.root }.filter(::isOurs)
        val active = instrumentation.uiAutomation.rootInActiveWindow?.takeIf(::isOurs)
        return (listOfNotNull(active) + roots).distinctBy { it.windowId }
    }

    fun clearSystemDialogs(timeoutMillis: Long = SystemDialogs.TIMEOUT_MILLIS): BlockingDialog? {
        val end = System.currentTimeMillis() + timeoutMillis
        var last: BlockingDialog? = null
        while (true) {
            val dialog = SystemDialogs.blocking(windows(), context.packageName) ?: return last
            last = dialog
            val dismissed = SystemDialogs.dismiss(dialog, instrumentation.uiAutomation)
            Log.w(TAG, "a system dialog covered the app (${dialog.describe()}); dismissed: $dismissed")
            if (System.currentTimeMillis() > end) fail("a system dialog stayed on top of the app for $timeoutMillis ms: ${dialog.describe()}")
            Thread.sleep(SystemDialogs.AFTER_DISMISS_MILLIS)
        }
    }

    private fun labels(node: AccessibilityNodeInfo): List<String> = listOfNotNull(node.text?.toString(), node.contentDescription?.toString())

    private fun findClickable(node: AccessibilityNodeInfo, text: String, clickableAbove: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        val clickable = if (node.isClickable && node.isEnabled && node.isVisibleToUser) node else clickableAbove
        if (labels(node).any { it.contains(text, ignoreCase = true) } && clickable != null) return clickable
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            findClickable(child, text, clickable)?.let { return it }
        }
        return null
    }

    fun accessibilityLabels(): List<String> {
        clearSystemDialogs()
        val found = ArrayList<String>()
        fun walk(node: AccessibilityNodeInfo) {
            found += labels(node)
            for (index in 0 until node.childCount) node.getChild(index)?.let(::walk)
        }
        accessibilityRoots().forEach(::walk)
        return found.distinct()
    }

    private fun semanticsClick(text: String): (() -> Boolean)? = onMain {
        activities(Stage.RESUMED).flatMap { composeRoots(it.window.decorView) }
            .firstNotNullOfOrNull { findSemanticsClick(it.semanticsOwner.unmergedRootSemanticsNode, text, null) }
    }

    fun inSemantics(text: String): Boolean = semanticsClick(text) != null

    fun tapThroughSemantics(text: String): Boolean = semanticsClick(text)?.let { click -> onMain(click) } == true

    private fun composeRoots(view: View): List<RootForTest> = buildList {
        if (view is RootForTest) add(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) addAll(composeRoots(view.getChildAt(index)))
    }

    private fun findSemanticsClick(node: SemanticsNode, text: String, clickAbove: (() -> Boolean)?): (() -> Boolean)? {
        val click = node.config.getOrNull(SemanticsActions.OnClick)?.action ?: clickAbove
        val words = node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } + node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        if (words.any { it.contains(text, ignoreCase = true) } && click != null) return click
        for (child in node.children) findSemanticsClick(child, text, click)?.let { return it }
        return null
    }

    fun settledScreenshot(timeoutMillis: Long = 12_000, stableFrames: Int = 2): Bitmap {
        instrumentation.waitForIdleSync()
        val start = System.currentTimeMillis()
        var settleEnd = start + timeoutMillis
        val dialogEnd = start + timeoutMillis + SystemDialogs.TIMEOUT_MILLIS
        var lastDialog: BlockingDialog? = null
        var previous: Bitmap? = null
        var stable = 0
        while (true) {
            clearSystemDialogs()?.let { dismissed ->
                lastDialog = dismissed
                stable = 0
                settleEnd = maxOf(settleEnd, System.currentTimeMillis() + SETTLE_AFTER_DIALOG_MILLIS)
            }
            val current = instrumentation.uiAutomation.takeScreenshot()
            val coveredNow = SystemDialogs.blocking(windows(), context.packageName)
            if (current != null && coveredNow != null) {
                current.recycle()
                lastDialog = coveredNow
                stable = 0
                settleEnd = maxOf(settleEnd, System.currentTimeMillis() + SETTLE_AFTER_DIALOG_MILLIS)
            } else if (current != null) {
                if (previous != null && current.sameAs(previous)) stable++ else stable = 0
                previous?.recycle()
                previous = current
            }
            val now = System.currentTimeMillis()
            val clean = previous
            if (clean != null && coveredNow == null && (stable >= stableFrames || now > settleEnd)) return clean
            if (now > dialogEnd) {
                val dialog = lastDialog?.describe() ?: "no dialog was recorded"
                throw AssertionError("no capture free of system dialogs within ${now - start} ms; last dialog: $dialog")
            }
            Thread.sleep(SETTLE_STEP_MILLIS)
            instrumentation.waitForIdleSync()
        }
    }

    fun leaveNoSystemScreenOnTop() {
        val end = System.currentTimeMillis() + SystemDialogs.TIMEOUT_MILLIS
        while (true) {
            val left = SystemDialogs.blocking(windows(), context.packageName) ?: return
            if (left.kind == SystemDialogs.Kind.OtherWindow) return
            val dismissed = SystemDialogs.dismiss(left, instrumentation.uiAutomation)
            Log.w(TAG, "a system screen was left on top after the test (${left.describe()}); dismissed: $dismissed")
            if (System.currentTimeMillis() > end) fail("a system screen stayed on top after the test: ${left.describe()}")
            Thread.sleep(SystemDialogs.AFTER_DISMISS_MILLIS)
        }
    }

    fun save(bitmap: Bitmap, fileName: String) {
        val bytes = java.io.ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
        val saved = ArrayList<String>()
        val problems = ArrayList<String>()
        additionalOutputDirectory()?.let { directory ->
            runCatching {
                directory.mkdirs()
                File(directory, fileName).writeBytes(bytes)
                saved.add(File(directory, fileName).path)
            }.onFailure { problems.add("additionalTestOutputDir: $it") }
        }
        runCatching {
            TestStorage().openOutputFile(fileName).use { it.write(bytes) }
            saved.add("test storage $fileName")
        }.onFailure { problems.add("test storage: $it") }
        runCatching {
            val directory = File(context.externalMediaDirs.first(), "screen-tour")
            directory.mkdirs()
            File(directory, fileName).writeBytes(bytes)
            saved.add(File(directory, fileName).path)
        }.onFailure { problems.add("media folder: $it") }
        Log.i(TAG, "saved $fileName to ${saved.joinToString()}${if (problems.isEmpty()) "" else "; failed: ${problems.joinToString()}"}")
        if (saved.isEmpty()) fail("$fileName could not be saved anywhere: ${problems.joinToString()}")
    }

    fun additionalOutputDirectory(): File? {
        context.externalMediaDirs
        return InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
    }
}

class AppSession(val activity: MainActivity) : AutoCloseable {
    override fun close() {
        AppTest.finishAll()
    }
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

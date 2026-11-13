package com.ardia.browser

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.view.Window
import android.widget.FrameLayout
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

class PageTestActivity : Activity() {
    lateinit var container: FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        container = FrameLayout(this)
        setContentView(container)
    }
}

class RecordingPreferences(var nightShade: NightShadeMode = NightShadeMode.Disabled) : SitePreferences {
    val zooms = HashMap<String, Double?>()

    override fun nightShade(host: String?, isPrivate: Boolean) = nightShade

    override fun pageZoom(host: String?, isPrivate: Boolean): Double? = host?.let { zooms[it] }

    override fun setPageZoom(host: String, isPrivate: Boolean, zoom: Double?) {
        zooms[host] = zoom
    }

    override fun opensLinksInApps(host: String?, isPrivate: Boolean) = false
}

class PageHarness(preferences: SitePreferences = RecordingPreferences(), liveLimit: Int = DevelopmentWebViewEngine.LIVE_LIMIT) : AutoCloseable {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val server = TestServer()
    val engine: DevelopmentWebViewEngine = onMain { DevelopmentWebViewEngine(context, preferences, liveLimit) }
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val opened = ArrayList<String>()
    private var scenario: ActivityScenario<PageTestActivity>? = null

    init {
        onMainSuspending { engine.clearWebsiteData(setOf(WebsiteDataKind.CookiesAndSiteData)) }
    }

    fun open(id: String, path: String? = null, isPrivate: Boolean = false): Page {
        opened += id
        return onMain { engine.open(id, PageSetup(url = path?.let(server::url), isPrivate = isPrivate)) }
    }

    fun load(page: Page, path: String) = onMain { page.load(server.url(path)) }

    fun show(page: Page) {
        val launched = scenario ?: ActivityScenario.launch(PageTestActivity::class.java).also { scenario = it }
        launched.onActivity { activity ->
            engine.attach(activity)
            val view = page.view.value ?: return@onActivity
            (view.parent as? ViewGroup)?.removeView(view)
            activity.container.removeAllViews()
            activity.container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
    }

    fun withActivity(block: (PageTestActivity) -> Unit) {
        val launched = checkNotNull(scenario) { "show a page first" }
        launched.onActivity(block)
    }

    fun shell(command: String): String {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        return android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes().toString(Charsets.UTF_8) }
    }

    fun <T> await(flow: StateFlow<T>, timeoutMillis: Long = 20_000, predicate: (T) -> Boolean): T = runBlocking {
        withTimeout(timeoutMillis) { flow.first(predicate) }
    }

    fun awaitTitle(page: Page, title: String): PageState = await(page.state) { it.title == title && !it.isLoading }

    fun <T : Any> poll(timeoutMillis: Long = 20_000, intervalMillis: Long = 100, probe: () -> T?): T {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (true) {
            probe()?.let { return it }
            if (System.currentTimeMillis() > deadline) throw AssertionError("Nothing matched within $timeoutMillis ms")
            Thread.sleep(intervalMillis)
        }
    }

    inline fun <reified E : PageEvent> expectEvent(page: Page, crossinline matches: (E) -> Boolean = { true }): Deferred<E> =
        scope.async(start = CoroutineStart.UNDISPATCHED) { page.events.first { it is E && matches(it) } as E }

    fun <T> result(deferred: Deferred<T>, timeoutMillis: Long = 20_000): T = runBlocking { withTimeout(timeoutMillis) { deferred.await() } }

    fun <T> onMainSuspending(block: suspend () -> T): T = runBlocking { withTimeout(20_000) { withContext(Dispatchers.Main) { block() } } }

    override fun close() {
        onMain { opened.forEach { engine.close(it) } }
        scenario?.close()
        scope.cancel()
        server.close()
    }
}

fun <T> onMain(block: () -> T): T {
    val result = AtomicReference<Result<T>>()
    InstrumentationRegistry.getInstrumentation().runOnMainSync { result.set(runCatching(block)) }
    return result.get().getOrThrow()
}

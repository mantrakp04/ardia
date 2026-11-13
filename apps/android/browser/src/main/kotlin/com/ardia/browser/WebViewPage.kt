package com.ardia.browser

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

internal class WebViewPage(
    override val id: String,
    override val isPrivate: Boolean,
    internal val engine: DevelopmentWebViewEngine,
    setup: PageSetup,
    private var popup: PopupRequest?,
) : Page, DiscardablePage {
    private val mutableState = MutableStateFlow(PageState(url = setup.url, title = setup.title))
    private val mutableView = MutableStateFlow<View?>(null)
    private val mutableRequest = MutableStateFlow<PageRequest?>(null)
    private val mutableFind = MutableStateFlow<FindResult?>(null)
    internal val mutableFullscreen = MutableStateFlow<FullscreenVideo?>(null)
    private val mutableEvents = MutableSharedFlow<PageEvent>(extraBufferCapacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    override val state: StateFlow<PageState> = mutableState.asStateFlow()
    override val view: StateFlow<View?> = mutableView.asStateFlow()
    override val request: StateFlow<PageRequest?> = mutableRequest.asStateFlow()
    override val find: StateFlow<FindResult?> = mutableFind.asStateFlow()
    override val fullscreen: StateFlow<FullscreenVideo?> = mutableFullscreen.asStateFlow()
    override val events: SharedFlow<PageEvent> = mutableEvents.asSharedFlow()

    private var webView: WebView? = null
    internal val webViewOrNull: WebView? get() = webView
    private var savedBundle: Bundle? = setup.savedState?.let(PageStateBundles::read)
    private var firstVisit: VisitKind? = setup.firstVisit
    private var pendingUrl: String? = null
    private var desktopSite = false
    private var crashReloads = 0
    private var released = false
    private var systemUserAgent = ""
    private var filterHandler: ScriptHandler? = null
    private var installedStart: List<String>? = null
    private var installedEnd: List<String>? = null
    private var installedBundle: String? = null
    private val progressThrottle = ProgressThrottle()
    private val scrollTracker = ScrollDirectionTracker()
    private var pendingVisit: VisitKind? = null
    private var lastCommitAt = Long.MIN_VALUE / 2
    private var lastCommittedUrl: String? = null
    private var failedUrl: String? = null
    private var findQuery = ""
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    internal val answeredSignIns = HashSet<String>()
    internal var lastCaptureRoute: CaptureRoute? = null
    private var reportsContent = false
    private var nextVisualStateRequest = 1L

    @Volatile
    internal var filterPageUrl: String? = setup.url

    @Volatile
    internal var sawInsecureContent = false
    private val blockedCount = AtomicInteger()
    private val blockedFlushPending = AtomicBoolean()
    private val reachedSchemes = java.util.concurrent.ConcurrentHashMap<String, Int>()

    override val isLive: Boolean get() = webView != null

    override fun makeLive() {
        if (webView != null || released) return
        val web = engine.createWebView(isPrivate)
        configure(web)
        webView = web
        mutableView.value = web
        val zoom = engine.sitePreferences.pageZoom(mutableState.value.host, isPrivate) ?: 1.0
        web.settings.textZoom = (zoom * 100).roundToInt()
        update { it.copy(isLive = true, pageZoom = zoom, isDesktopSite = desktopSite) }
        val popup = popup
        this.popup = null
        val saved = savedBundle
        savedBundle = null
        val url = mutableState.value.url
        val pending = pendingUrl
        pendingUrl = null
        when {
            popup != null -> {
                pendingVisit = VisitKind.Link
                val transport = popup.transport.obj as? WebView.WebViewTransport
                transport?.webView = web
                popup.transport.sendToTarget()
            }
            pending != null -> navigate(web, pending, VisitKind.Typed)
            saved != null && restore(web, saved, url) -> Unit
            url != null && BrowserUrl.scheme(url) != BrowserUrl.BROWSE_SCHEME -> navigate(web, url, firstVisit ?: VisitKind.Restored)
        }
        firstVisit = null
    }

    override fun discard() {
        val web = webView ?: return
        savedBundle = Bundle().also { saveInto(web, it) }
        tearDown(web)
    }

    internal fun release() {
        released = true
        webView?.let(::tearDown)
        savedBundle = null
        popup = null
    }

    override fun close() = engine.close(id)

    override fun load(url: String) {
        failedUrl = null
        update { it.copy(failure = null) }
        val web = webView
        if (web == null) {
            pendingUrl = url
            update { it.copy(url = url) }
            return
        }
        navigate(web, url, VisitKind.Typed)
    }

    override fun reload() {
        failedUrl = null
        crashReloads = 0
        update { it.copy(failure = null) }
        val web = webView
        if (web == null) {
            makeLive()
            return
        }
        val current = web.url
        if (current == null) {
            mutableState.value.url?.let { navigate(web, it, VisitKind.Typed) }
            return
        }
        pendingVisit = null
        prepareNavigation(web, current)
        web.reload()
    }

    override fun stop() {
        webView?.stopLoading()
    }

    override fun goBack(): Boolean = goBy(-1)

    override fun goForward(): Boolean = goBy(1)

    private fun goBy(step: Int): Boolean {
        val web = webView ?: return false
        if (!web.canGoBackOrForward(step)) return false
        failedUrl = null
        update { it.copy(failure = null) }
        val list = web.copyBackForwardList()
        list.getItemAtIndex(list.currentIndex + step)?.url?.let { prepareNavigation(web, it) }
        pendingVisit = VisitKind.BackForward
        web.goBackOrForward(step)
        return true
    }

    override fun find(text: String) {
        val web = webView ?: return
        findQuery = text
        if (text.isEmpty()) {
            web.clearMatches()
            mutableFind.value = FindResult("", -1, 0, true)
            return
        }
        mutableFind.value = FindResult(text, -1, 0, false)
        web.findAllAsync(text)
    }

    override fun findNext() {
        if (findQuery.isNotEmpty()) webView?.findNext(true)
    }

    override fun findPrevious() {
        if (findQuery.isNotEmpty()) webView?.findNext(false)
    }

    override fun endFind() {
        findQuery = ""
        webView?.clearMatches()
        mutableFind.value = null
    }

    override fun setPageZoom(zoom: Double) {
        val clamped = PageZoom.clamp(zoom)
        applyZoom(clamped)
        mutableState.value.host?.let { engine.sitePreferences.setPageZoom(it, isPrivate, if (clamped == 1.0) null else clamped) }
    }

    override fun zoomIn() {
        PageZoom.next(mutableState.value.pageZoom)?.let(::setPageZoom)
    }

    override fun zoomOut() {
        PageZoom.previous(mutableState.value.pageZoom)?.let(::setPageZoom)
    }

    override fun setDesktopSite(enabled: Boolean) {
        if (desktopSite == enabled) return
        desktopSite = enabled
        update { it.copy(isDesktopSite = enabled) }
        val web = webView ?: return
        applyUserAgent(web)
        reload()
    }

    override fun download(url: String) {
        emitDownload(url, webView?.settings?.userAgentString, null, null, -1)
    }

    override suspend fun readableContent(): ReadableContent {
        val script = withContext(Dispatchers.IO) { engine.scripts.reader }
        val raw = withContext(Dispatchers.Main.immediate) {
            val web = webView ?: throw ReadableContentException(ReadableContentException.Reason.PageNotLoaded)
            evaluate(web, PageScripts.readerCall(script))
        }
        val json = PageScripts.decodeEvaluationResult(raw) ?: throw ReadableContentException(ReadableContentException.Reason.NotReadable)
        return withContext(Dispatchers.Default) {
            runCatching { ReadableContent.fromJson(json) }.getOrElse { throw ReadableContentException(ReadableContentException.Reason.NotReadable) }
        }
    }

    override suspend fun snapshot(maxWidth: Int): Bitmap? = withContext(Dispatchers.Main.immediate) {
        val web = webView ?: return@withContext null
        if (!PageCapture.isDrawable(web) || mutableState.value.url == null) return@withContext null
        val scale = min(1f, maxWidth.toFloat() / web.width)
        val width = (web.width * scale).roundToInt().coerceAtLeast(1)
        val height = (web.height * scale).roundToInt().coerceAtLeast(1)
        val region = Rect(0, 0, web.width, web.height)
        repeat(DRAW_ATTEMPTS) { attempt ->
            if (webView !== web || !PageCapture.isDrawable(web)) return@withContext null
            val drawn = PageCapture.drawView(web, region, width, height)
            if (!isSuspect(drawn)) {
                lastCaptureRoute = CaptureRoute.ViewDraw
                return@withContext drawn
            }
            drawn.recycle()
            if (attempt < DRAW_ATTEMPTS - 1) awaitPaintedFrame(web)
        }
        if (webView !== web || !PageCapture.windowCopyIsTrustworthy(web)) return@withContext null
        val copied = PageCapture.copyWindow(web, region, width, height) ?: return@withContext null
        if (isSuspect(copied)) {
            copied.recycle()
            return@withContext null
        }
        lastCaptureRoute = CaptureRoute.WindowCopy
        copied
    }

    override suspend fun sampleTone(topInset: Int, bottomInset: Int): PageTone? = withContext(Dispatchers.Main.immediate) {
        val web = webView ?: return@withContext null
        if (!PageCapture.isDrawable(web)) return@withContext null
        val band = (ToneSampler.BAND_HEIGHT_DP * web.resources.displayMetrics.density).roundToInt().coerceAtLeast(1)
        if (web.height <= topInset + bottomInset + band * 3) return@withContext null
        val top = Rect(0, topInset + 1, web.width, topInset + 1 + band)
        val bottomEdge = web.height - bottomInset - band - 2
        val bottom = Rect(0, bottomEdge, web.width, bottomEdge + band)
        var topCapture = sampleBand(web, top, CaptureRoute.ViewDraw) ?: return@withContext null
        var bottomCapture = sampleBand(web, bottom, topCapture.route) ?: return@withContext null
        if (topCapture.route != bottomCapture.route) {
            topCapture.bitmap.recycle()
            topCapture = sampleBand(web, top, bottomCapture.route) ?: return@withContext null
            if (topCapture.route != bottomCapture.route) {
                topCapture.bitmap.recycle()
                bottomCapture.bitmap.recycle()
                return@withContext null
            }
        }
        lastCaptureRoute = topCapture.route
        val topColor = ToneSampler.dominant(PageCapture.pixels(topCapture.bitmap))
        val bottomColor = ToneSampler.dominant(PageCapture.pixels(bottomCapture.bitmap))
        topCapture.bitmap.recycle()
        bottomCapture.bitmap.recycle()
        if (topColor == null && bottomColor == null) null else PageTone(topColor, bottomColor)
    }

    private suspend fun sampleBand(web: WebView, region: Rect, preferred: CaptureRoute): Capture? {
        if (preferred == CaptureRoute.ViewDraw) {
            val drawn = PageCapture.drawView(web, region, ToneSampler.SAMPLE_WIDTH, ToneSampler.SAMPLE_HEIGHT)
            if (!PageCapture.isBlank(drawn, blackIsBlank = false)) return Capture(drawn, CaptureRoute.ViewDraw)
            drawn.recycle()
        }
        if (!PageCapture.windowCopyIsTrustworthy(web)) return null
        val copied = PageCapture.copyWindow(web, region, ToneSampler.SAMPLE_WIDTH, ToneSampler.SAMPLE_HEIGHT) ?: return null
        if (PageCapture.isBlank(copied, blackIsBlank = false)) {
            copied.recycle()
            return null
        }
        return Capture(copied, CaptureRoute.WindowCopy)
    }

    private fun isSuspect(picture: Bitmap): Boolean =
        PageCapture.isBlank(picture, blackIsBlank = true) || (reportsContent && PageCapture.isNearlyUniform(picture))

    @SuppressLint("RequiresFeature")
    private suspend fun awaitPaintedFrame(web: WebView) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.VISUAL_STATE_CALLBACK)) {
            withTimeoutOrNull(VISUAL_STATE_WAIT_MILLIS) {
                suspendCancellableCoroutine { continuation ->
                    WebViewCompat.postVisualStateCallback(web, nextVisualStateRequest++) { if (continuation.isActive) continuation.resume(Unit) }
                }
            }
        }
        withTimeoutOrNull(FRAME_WAIT_MILLIS) {
            suspendCancellableCoroutine { continuation ->
                val callback = Choreographer.FrameCallback { if (continuation.isActive) continuation.resume(Unit) }
                Choreographer.getInstance().postFrameCallback(callback)
                continuation.invokeOnCancellation { Choreographer.getInstance().removeFrameCallback(callback) }
            }
        }
    }

    override fun saveState(): ByteArray? {
        val bundle = webView?.let { web -> Bundle().also { saveInto(web, it) } } ?: savedBundle ?: return null
        return PageStateBundles.write(bundle)
    }

    internal fun applySitePreferences() {
        val web = webView ?: return
        val host = mutableState.value.host
        applyNightShade(web, engine.sitePreferences.nightShade(host, isPrivate))
        applyZoom(engine.sitePreferences.pageZoom(host, isPrivate) ?: 1.0)
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility", "RequiresFeature")
    private fun configure(web: WebView) {
        with(web.settings) {
            systemUserAgent = userAgentString
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            builtInZoomControls = true
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(true)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(this, false)
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.HYPERLINK_CONTEXT_MENU_ITEMS)) {
                WebSettingsCompat.setHyperlinkContextMenuItems(this, WebSettingsCompat.HYPERLINK_CONTEXT_MENU_DISABLED)
            }
        }
        applyUserAgent(web)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webViewClient = WebViewPageClient(this)
        web.webChromeClient = WebViewPageChromeClient(this)
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
            emitDownload(url, userAgent, contentDisposition, mimeType, contentLength)
        }
        web.setFindListener { ordinal, count, isDone ->
            if (findQuery.isNotEmpty()) mutableFind.value = FindResult(findQuery, if (count == 0) -1 else ordinal, count, isDone)
        }
        web.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) {
                lastTouchX = event.x
                lastTouchY = event.y
            }
            false
        }
        web.setOnLongClickListener { longPressed(web) }
        web.setOnScrollChangeListener { _, _, scrollY, _, _ -> scrolled(web, scrollY) }
        if (engine.supportsDocumentStartScripts) {
            WebViewCompat.addDocumentStartJavaScript(web, PageScripts.mainFrameOnly(engine.scripts.nightShade), setOf("*"))
        }
        if (engine.supportsMessageListener) {
            WebViewCompat.addWebMessageListener(web, PageScripts.BRIDGE_NAME, setOf("*")) { _, message, origin, _, reply ->
                if (message.data == PageScripts.NIGHT_SHADE_MESSAGE) {
                    reply.postMessage(engine.sitePreferences.nightShade(BrowserUrl.host(origin.toString()), isPrivate).raw)
                }
            }
        }
    }

    @SuppressLint("RequiresFeature")
    private fun applyUserAgent(web: WebView) {
        val settings = web.settings
        settings.userAgentString = if (desktopSite) BrowserUserAgent.desktop(systemUserAgent) else BrowserUserAgent.mobile(systemUserAgent)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) return
        runCatching {
            val major = BrowserUserAgent.chromeMajor(systemUserAgent)
            val brands = listOf(
                UserAgentMetadata.BrandVersion.Builder().setBrand("Chromium").setMajorVersion(major).setFullVersion("$major.0.0.0").build(),
                UserAgentMetadata.BrandVersion.Builder().setBrand("Not)A;Brand").setMajorVersion("99").setFullVersion("99.0.0.0").build(),
            )
            val metadata = UserAgentMetadata.Builder(WebSettingsCompat.getUserAgentMetadata(settings))
                .setBrandVersionList(brands)
                .setMobile(!desktopSite)
                .setPlatform(if (desktopSite) "Linux" else "Android")
                .build()
            WebSettingsCompat.setUserAgentMetadata(settings, metadata)
        }
    }

    private fun navigate(web: WebView, url: String, kind: VisitKind) {
        pendingVisit = kind
        prepareNavigation(web, url)
        web.loadUrl(url)
    }

    private fun restore(web: WebView, saved: Bundle, url: String?): Boolean {
        url?.let { prepareNavigation(web, it) }
        pendingVisit = VisitKind.Restored
        val restored = web.restoreState(saved)
        if (restored != null && restored.currentItem != null) return true
        pendingVisit = null
        return false
    }

    @SuppressLint("RequiresFeature")
    private fun saveInto(web: WebView, bundle: Bundle) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAVE_STATE)) {
            WebViewCompat.saveState(web, bundle, SAVED_STATE_LIMIT, true)
        } else {
            web.saveState(bundle)
        }
    }

    private fun tearDown(web: WebView) {
        mutableRequest.value?.dismiss()
        mutableRequest.value = null
        mutableFullscreen.value?.exit()
        mutableFullscreen.value = null
        findQuery = ""
        mutableFind.value = null
        filterHandler = null
        installedStart = null
        installedEnd = null
        installedBundle = null
        web.stopLoading()
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        webView = null
        mutableView.value = null
        progressThrottle.reset()
        scrollTracker.reset()
        update { it.copy(isLive = false, isLoading = false, progress = 0f) }
    }

    internal fun prepareNavigation(web: WebView, url: String) {
        filterPageUrl = url
        installFilterScripts(web, url)
    }

    @SuppressLint("RequiresFeature")
    private fun installFilterScripts(web: WebView, url: String): Boolean {
        val filter = engine.filterFor(isPrivate)
        val start = filter?.scriptsAtDocumentStart(url).orEmpty()
        val end = filter?.scriptsAtDocumentEnd(url).orEmpty()
        if (start == installedStart && end == installedEnd) return false
        installedStart = start
        installedEnd = end
        filterHandler?.remove()
        filterHandler = null
        val bundle = PageScripts.filterBundle(start, end)
        installedBundle = bundle
        if (bundle != null && engine.supportsDocumentStartScripts) {
            filterHandler = WebViewCompat.addDocumentStartJavaScript(web, bundle, setOf("*"))
        }
        return true
    }

    internal fun pageStarted(web: WebView, url: String) {
        if (web !== webView) return
        filterPageUrl = url
        reportsContent = false
        val changed = installFilterScripts(web, url)
        if (!engine.supportsDocumentStartScripts) {
            web.evaluateJavascript(PageScripts.mainFrameOnly(engine.scripts.nightShade), null)
            installedBundle?.let { web.evaluateJavascript(it, null) }
        } else if (changed) {
            installedBundle?.let { web.evaluateJavascript(it, null) }
        }
        val host = BrowserUrl.host(url)
        if (!engine.supportsMessageListener) applyNightShade(web, engine.sitePreferences.nightShade(host, isPrivate))
        scrollTracker.reset()
        val zoom = engine.sitePreferences.pageZoom(host, isPrivate) ?: 1.0
        web.settings.textZoom = (zoom * 100).roundToInt()
        val keepsFailure = failedUrl != null && BrowserUrl.withoutFragment(failedUrl!!) == BrowserUrl.withoutFragment(url)
        if (!keepsFailure) failedUrl = null
        update {
            it.copy(
                url = url,
                isLoading = true,
                failure = if (keepsFailure) it.failure else null,
                security = PageSecurity.of(url, sawInsecureContent),
                canGoBack = web.canGoBack(),
                canGoForward = web.canGoForward(),
                faviconUrl = null,
                favicon = null,
                themeColor = null,
                backgroundColor = null,
                scrollDirection = ScrollDirection.Up,
                isScrolledToTop = true,
                blockedRequests = blockedCount.get(),
                pageZoom = zoom,
            )
        }
    }

    internal fun pageFinished(web: WebView, url: String) {
        if (web !== webView) return
        crashReloads = 0
        progressThrottle.reset()
        answeredSignIns.clear()
        update {
            it.copy(
                url = web.url ?: url,
                isLoading = false,
                progress = 0f,
                canGoBack = web.canGoBack(),
                canGoForward = web.canGoForward(),
                security = PageSecurity.of(web.url ?: url, sawInsecureContent),
            )
        }
        readPageLook(web)
    }

    internal fun historyUpdated(web: WebView, url: String, isReload: Boolean) {
        if (web !== webView) return
        val previous = lastCommittedUrl
        lastCommittedUrl = url
        val kind = pendingVisit
        pendingVisit = null
        val now = SystemClock.elapsedRealtime()
        val sinceLastCommit = now - lastCommitAt
        lastCommitAt = now
        update { it.copy(url = url, canGoBack = web.canGoBack(), canGoForward = web.canGoForward()) }
        if (isReload) return
        val visit = when {
            kind != null -> kind
            previous != null && BrowserUrl.withoutFragment(previous) == BrowserUrl.withoutFragment(url) -> null
            previous != null && sinceLastCommit < CLIENT_REDIRECT_WINDOW_MILLIS -> VisitKind.Redirect
            else -> VisitKind.Link
        }
        if (visit != null) mutableEvents.tryEmit(PageEvent.Visited(url, cleanTitle(web.title, url), visit))
    }

    internal fun rendererNavigationKind(hasGesture: Boolean): VisitKind = when {
        hasGesture -> VisitKind.Link
        SystemClock.elapsedRealtime() - lastCommitAt < CLIENT_REDIRECT_WINDOW_MILLIS -> VisitKind.Redirect
        else -> VisitKind.Link
    }

    internal fun startRendererNavigation(web: WebView, url: String, kind: VisitKind?) {
        failedUrl = null
        if (mutableState.value.failure != null) update { it.copy(failure = null) }
        if (kind != null) pendingVisit = kind
        noteRequest(BrowserUrl.scheme(url), BrowserUrl.rawHost(url))
        prepareNavigation(web, url)
    }

    internal fun progressChanged(web: WebView, percent: Int) {
        if (web !== webView || !mutableState.value.isLoading) return
        val value = progressThrottle.offer(percent / 100.0, SystemClock.uptimeMillis()) ?: return
        update { it.copy(progress = value) }
    }

    internal fun titleReceived(web: WebView, title: String?) {
        if (web !== webView) return
        val clean = cleanTitle(title, web.url)
        if (clean.isEmpty() || clean == mutableState.value.title) return
        update { it.copy(title = clean) }
    }

    internal fun iconReceived(web: WebView, icon: Bitmap?) {
        if (web === webView && icon != null) update { it.copy(favicon = icon) }
    }

    internal fun failed(web: WebView, url: String, reason: NetworkFailure) {
        if (web !== webView) return
        failedUrl = url
        update { it.copy(failure = PageLoadFailure.Network(reason)) }
    }

    internal fun rendererGone(web: WebView, didCrash: Boolean) {
        if (web !== webView) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
            return
        }
        tearDown(web)
        if (!didCrash || released) return
        if (crashReloads == 0) {
            crashReloads += 1
            engine.mainHandler.post { makeLive() }
        } else {
            update { it.copy(failure = PageLoadFailure.Crashed) }
        }
    }

    internal fun noteInsecureContent() {
        engine.mainHandler.post {
            val current = mutableState.value
            val security = PageSecurity.of(current.url, sawInsecureContent)
            if (security != current.security) update { it.copy(security = security) }
        }
    }

    internal fun startDocumentRequests() {
        sawInsecureContent = false
        reachedSchemes.clear()
        blockedCount.set(0)
        scheduleBlockedFlush()
    }

    internal fun noteRequest(scheme: String?, host: String?) {
        val key = host?.lowercase() ?: return
        val bit = when (scheme?.lowercase()) {
            "https" -> REACHED_SECURELY
            else -> REACHED_INSECURELY
        }
        reachedSchemes.merge(key, bit) { old, new -> old or new }
    }

    internal fun signInIsSecure(host: String): Boolean =
        BrowserUrl.isSecure(filterPageUrl) && reachedSchemes[host.lowercase()] == REACHED_SECURELY

    internal fun countBlocked() {
        blockedCount.incrementAndGet()
        scheduleBlockedFlush()
    }

    private fun scheduleBlockedFlush() {
        if (!blockedFlushPending.compareAndSet(false, true)) return
        engine.mainHandler.postDelayed({
            blockedFlushPending.set(false)
            val count = blockedCount.get()
            if (count != mutableState.value.blockedRequests) update { it.copy(blockedRequests = count) }
        }, BLOCKED_FLUSH_MILLIS)
    }

    internal fun ask(kind: PageRequest.Kind, host: String, completion: (PageRequest.Answer) -> Unit): PageRequest {
        lateinit var request: PageRequest
        request = PageRequest(kind, host) { answer ->
            mutableRequest.compareAndSet(request, null)
            onMain { completion(answer) }
        }
        mutableRequest.value?.dismiss()
        mutableRequest.value = request
        return request
    }

    internal fun withdraw(request: PageRequest?) {
        if (request != null && mutableRequest.value === request) request.dismiss()
    }

    internal fun askToOpenExternal(url: String, route: LinkRoute.External) {
        ask(PageRequest.Kind.OpenExternal(url, route.app), mutableState.value.host ?: "") { answer ->
            if (answer != PageRequest.Answer.Accepted) return@ask
            val launched = ExternalLauncher.intentFor(url)?.let(::launch) ?: false
            if (launched) return@ask
            val fallback = route.fallbackUrl
            if (fallback != null) load(fallback) else mutableEvents.tryEmit(PageEvent.ExternalAppMissing(url))
        }
    }

    internal fun opensInApp(url: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        val target = BrowserUrl.host(url) ?: return false
        if (target == mutableState.value.host || !engine.sitePreferences.opensLinksInApps(target, isPrivate)) return false
        return launch(ExternalLauncher.appLinkIntent(url))
    }

    internal fun emit(event: PageEvent) {
        mutableEvents.tryEmit(event)
    }

    internal fun currentHost(): String = mutableState.value.host ?: ""

    private fun launch(intent: Intent): Boolean {
        val activity = engine.hostActivity()
        return try {
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                engine.appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            true
        } catch (error: ActivityNotFoundException) {
            false
        } catch (error: SecurityException) {
            false
        }
    }

    private fun emitDownload(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?, contentLength: Long) {
        val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            .replace('/', '-')
            .replace(':', '-')
            .trim()
            .trim('.')
            .ifEmpty { engine.appContext.getString(R.string.download_fallback_name) }
        mutableEvents.tryEmit(
            PageEvent.Download(
                PageDownload(
                    url = url,
                    fileName = fileName,
                    mimeType = mimeType?.ifBlank { null },
                    contentLength = contentLength,
                    userAgent = userAgent,
                    contentDisposition = contentDisposition,
                    referer = mutableState.value.url?.takeIf(BrowserUrl::isWeb),
                    isPrivate = isPrivate,
                    privateSession = if (isPrivate) engine.currentPrivateSession() else null,
                ),
            ),
        )
    }

    private fun longPressed(web: WebView): Boolean {
        val hit = web.hitTestResult
        val extra = hit.extra ?: return false
        val x = lastTouchX
        val y = lastTouchY
        return when (hit.type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE -> {
                if (ExternalLinks.route(extra) != LinkRoute.Web) return false
                requestFocusNode(web) { data -> emit(PageEvent.LongPress(PressTarget.Link(extra, data.getString("title")?.trim()?.ifEmpty { null }), x, y)) }
                true
            }
            WebView.HitTestResult.IMAGE_TYPE -> {
                emit(PageEvent.LongPress(PressTarget.Image(extra, null), x, y))
                true
            }
            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                requestFocusNode(web) { data ->
                    val link = data.getString("url")?.takeIf { ExternalLinks.route(it) == LinkRoute.Web }
                    emit(PageEvent.LongPress(PressTarget.Image(data.getString("src") ?: extra, link), x, y))
                }
                true
            }
            else -> false
        }
    }

    private fun requestFocusNode(web: WebView, onResult: (Bundle) -> Unit) {
        val handler = Handler(Looper.getMainLooper()) { message ->
            if (web === webView) onResult(message.data)
            true
        }
        web.requestFocusNodeHref(handler.obtainMessage())
    }

    private fun scrolled(web: WebView, scrollY: Int) {
        if (web !== webView) return
        val atTop = scrollY <= 1
        @Suppress("DEPRECATION")
        val contentHeight = web.contentHeight * web.scale.toDouble()
        val direction = scrollTracker.offer(scrollY.toDouble(), contentHeight, web.height.toDouble())
        val current = mutableState.value
        if (atTop == current.isScrolledToTop && (direction == null || direction == current.scrollDirection)) return
        update { it.copy(isScrolledToTop = atTop, scrollDirection = direction ?: it.scrollDirection) }
    }

    private fun readPageLook(web: WebView) {
        val url = web.url ?: return
        if (!BrowserUrl.isWeb(url)) return
        web.evaluateJavascript(engine.scripts.pageLook) { raw ->
            if (web !== webView || web.url != url) return@evaluateJavascript
            val look = PageScripts.decodeEvaluationResult(raw)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return@evaluateJavascript
            fun text(key: String): String? = if (look.isNull(key)) null else look.optString(key).ifEmpty { null }
            val favicon = text("icon") ?: Uri.parse(url).buildUpon().encodedPath("/favicon.ico").encodedQuery(null).fragment(null).build().toString()
            val theme = PageColors.parseCss(text("theme"))
            val background = PageColors.parseCss(text("background"))
            reportsContent = look.optBoolean("content", false)
            update { it.copy(faviconUrl = favicon, themeColor = theme, backgroundColor = background) }
        }
    }

    private fun applyZoom(zoom: Double) {
        webView?.settings?.textZoom = (zoom * 100).roundToInt()
        if (mutableState.value.pageZoom != zoom) update { it.copy(pageZoom = zoom) }
    }

    private fun applyNightShade(web: WebView, mode: NightShadeMode) {
        web.evaluateJavascript(PageScripts.nightShadeCall(mode), null)
    }

    private suspend fun evaluate(web: WebView, script: String): String? = suspendCancellableCoroutine { continuation ->
        web.evaluateJavascript(script) { continuation.resume(it) }
    }

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else engine.mainHandler.post(block)
    }

    private inline fun update(transform: (PageState) -> PageState) = mutableState.update(transform)

    companion object {
        private const val SAVED_STATE_LIMIT = 512 * 1024
        private const val CLIENT_REDIRECT_WINDOW_MILLIS = 1500L
        private const val BLOCKED_FLUSH_MILLIS = 250L
        private const val DRAW_ATTEMPTS = 2
        private const val VISUAL_STATE_WAIT_MILLIS = 300L
        private const val FRAME_WAIT_MILLIS = 100L
        private const val REACHED_SECURELY = 1
        private const val REACHED_INSECURELY = 2

        fun cleanTitle(title: String?, url: String?): String {
            val trimmed = title?.trim().orEmpty()
            if (trimmed.isEmpty() || url == null) return trimmed
            val withoutScheme = url.substringAfter("://")
            return if (trimmed == url || trimmed == withoutScheme || trimmed == withoutScheme.removeSuffix("/")) "" else trimmed
        }
    }
}

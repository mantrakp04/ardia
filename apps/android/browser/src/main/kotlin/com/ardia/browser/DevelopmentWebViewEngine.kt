package com.ardia.browser

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.MutableContextWrapper
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewStartUpConfig
import androidx.webkit.WebViewStartUpResult
import androidx.webkit.WebStorageCompat
import java.util.WeakHashMap
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

class DevelopmentWebViewEngine(
    context: Context,
    internal val sitePreferences: SitePreferences = SitePreferences.Defaults,
    liveLimit: Int = LIVE_LIMIT,
) : PageEngine {
    override val name: String = "System WebView (development only)"
    override val isDevelopmentOnly: Boolean = true

    internal val appContext: Context = context.applicationContext
    internal val mainHandler = Handler(Looper.getMainLooper())
    internal val scripts = PageScriptSources(appContext.assets)
    private val roster = LivePageRoster<WebViewPage>(liveLimit)
    private val contextWrappers = WeakHashMap<MutableContextWrapper, Unit>()
    private var hostActivity: Context? = null
    private val grantedPermissions = HashSet<String>()
    private val privateGrantedPermissions = HashSet<String>()
    private var privateProfileName: String? = null

    private class PrivateJar(val session: String, val cookies: CookieManager)

    @Volatile
    private var privateJar: PrivateJar? = null
    private val sessionEndListeners = java.util.concurrent.CopyOnWriteArrayList<(String) -> Unit>()
    private var profilesPrepared = false
    internal var privateSession = 0
        private set

    @Volatile
    override var filter: PageFilter? = null

    @Volatile
    override var privateFilter: PageFilter? = null

    internal fun filterFor(isPrivate: Boolean): PageFilter? = if (isPrivate) privateFilter ?: filter else filter

    override var onPrivateBrowsingEnded: (() -> Unit)? = null

    override var isInspectable: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            WebView.setWebContentsDebuggingEnabled(value)
        }

    internal var multiProfileSupported: Boolean? = null

    private val multiProfileFeature: Boolean by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }

    override val separatesPrivatePages: Boolean get() = multiProfileSupported ?: multiProfileFeature

    var captureUploads: UploadLocation = UploadLocation("${appContext.packageName}.browsing.captures", "/captures/")

    private val ownProviderAuthorities: Set<String> by lazy {
        val manager = appContext.packageManager
        val info = runCatching {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                manager.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(android.content.pm.PackageManager.GET_PROVIDERS.toLong()))
            } else {
                @Suppress("DEPRECATION")
                manager.getPackageInfo(appContext.packageName, android.content.pm.PackageManager.GET_PROVIDERS)
            }
        }.getOrNull()
        val declared = info?.providers.orEmpty().flatMap { it.authority.orEmpty().split(';') }.map { it.trim() }.filter { it.isNotEmpty() }
        (declared + captureUploads.authority).toSet()
    }

    internal val supportsDocumentStartScripts: Boolean by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) }

    internal val supportsMessageListener: Boolean by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }

    override val livePageIds: List<String> get() = roster.liveIds

    init {
        Executors.newSingleThreadExecutor().also { executor ->
            executor.execute { runCatching { scripts.preload() } }
            executor.shutdown()
        }
        appContext.registerComponentCallbacks(object : ComponentCallbacks2 {
            @Suppress("DEPRECATION")
            override fun onTrimMemory(level: Int) {
                if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW && level != ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
                    mainHandler.post { discardBackgroundPages() }
                }
            }

            override fun onConfigurationChanged(newConfig: Configuration) = Unit

            @Deprecated("Deprecated in Java")
            override fun onLowMemory() {
                mainHandler.post { discardBackgroundPages() }
            }
        })
    }

    override fun open(id: String, setup: PageSetup): Page {
        val existing = roster.page(id)
        if (existing == null && setup.isPrivate && !separatesPrivatePages) throw PrivatePagesUnavailableException()
        val page = existing ?: WebViewPage(id, setup.isPrivate, this, setup, popup = null).also { roster.register(it, id) }
        roster.activate(id)
        return page
    }

    override fun openPopup(id: String, popup: PopupRequest): Page {
        check(!popup.isClaimed) { "This popup already has a page" }
        if (popup.isPrivate && !separatesPrivatePages) throw PrivatePagesUnavailableException()
        popup.isClaimed = true
        roster.page(id)?.let { close(id) }
        val page = WebViewPage(id, popup.isPrivate, this, PageSetup(url = popup.url, isPrivate = popup.isPrivate), popup)
        roster.register(page, id)
        roster.activate(id)
        return page
    }

    override fun existing(id: String): Page? = roster.page(id)

    override fun close(id: String) {
        val page = roster.remove(id) ?: return
        page.release()
        if (page.isPrivate && roster.allPages.none { it.isPrivate }) endPrivateBrowsing()
    }

    override fun discardBackgroundPages() {
        roster.discardAll(except = roster.mostRecent)
    }

    override fun refreshSitePreferences() {
        for (id in roster.liveIds) roster.page(id)?.applySitePreferences()
    }

    override fun attach(activity: Context) {
        hostActivity = activity
        for (wrapper in contextWrappers.keys) wrapper.baseContext = activity
    }

    override fun detach(activity: Context) {
        if (hostActivity !== activity) return
        hostActivity = null
        for (wrapper in contextWrappers.keys) wrapper.baseContext = appContext
    }

    @androidx.annotation.OptIn(WebViewCompat.ExperimentalAsyncStartUp::class)
    override fun warmUp() {
        val executor = Executors.newSingleThreadExecutor()
        runCatching {
            WebViewCompat.startUpWebView(
                appContext,
                WebViewStartUpConfig.Builder(executor).build(),
                object : WebViewCompat.WebViewStartUpCallback {
                    override fun onSuccess(result: WebViewStartUpResult) {
                        executor.shutdown()
                    }
                },
            )
        }.onFailure { executor.shutdown() }
    }

    override suspend fun clearWebsiteData(kinds: Set<WebsiteDataKind>) = withContext(Dispatchers.Main) {
        prepareProfiles()
        if (WebsiteDataKind.Cache in kinds) {
            val live = roster.liveIds.mapNotNull { roster.page(it) }.firstOrNull { !it.isPrivate }?.webViewOrNull
            val webView = live ?: WebView(appContext)
            webView.clearCache(true)
            if (live == null) webView.destroy()
        }
        if (WebsiteDataKind.CookiesAndSiteData in kinds) {
            suspendCancellableCoroutine { continuation ->
                CookieManager.getInstance().removeAllCookies { continuation.resume(Unit) }
            }
            CookieManager.getInstance().flush()
            WebStorage.getInstance().deleteAllData()
            GeolocationPermissions.getInstance().clearAll()
            @Suppress("DEPRECATION")
            WebViewDatabase.getInstance(appContext).clearHttpAuthUsernamePassword()
            grantedPermissions.clear()
        }
    }

    @SuppressLint("RequiresFeature")
    internal fun createWebView(isPrivate: Boolean): WebView {
        if (isPrivate && !separatesPrivatePages) throw PrivatePagesUnavailableException()
        prepareProfiles()
        val wrapper = MutableContextWrapper(hostActivity ?: appContext)
        contextWrappers[wrapper] = Unit
        val webView = WebView(wrapper)
        if (isPrivate) WebViewCompat.setProfile(webView, privateProfile())
        return webView
    }

    override fun cookieHeader(url: String, isPrivate: Boolean): String? {
        if (!BrowserUrl.isWeb(url)) return null
        if (isPrivate) return null
        return runCatching { CookieManager.getInstance().getCookie(url) }.getOrNull()
    }

    override fun privateCookieHeader(url: String, session: String): String? {
        if (!BrowserUrl.isWeb(url)) return null
        val jar = privateJar?.takeIf { it.session == session } ?: return null
        return runCatching { jar.cookies.getCookie(url) }.getOrNull()
    }

    override fun isPrivateSessionLive(session: String): Boolean = privateJar?.session == session

    override fun addPrivateSessionEndListener(listener: (String) -> Unit): AutoCloseable {
        sessionEndListeners += listener
        return AutoCloseable { sessionEndListeners -= listener }
    }

    internal fun currentPrivateSession(): String? = privateJar?.session

    internal fun acceptsUpload(uri: String): Boolean = UploadCheck.accepts(uri, ownProviderAuthorities, captureUploads)

    @SuppressLint("RequiresFeature")
    private fun prepareProfiles() {
        if (profilesPrepared) return
        profilesPrepared = true
        if (!multiProfileFeature) return
        runCatching {
            val store = ProfileStore.getInstance()
            for (stale in store.allProfileNames.filter { it.startsWith(PRIVATE_PROFILE_PREFIX) }) {
                runCatching { store.deleteProfile(stale) }
            }
        }
    }

    internal fun isOnline(): Boolean {
        val connectivity = appContext.getSystemService(ConnectivityManager::class.java) ?: return true
        val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    internal fun isGranted(key: String, isPrivate: Boolean): Boolean =
        if (isPrivate) key in privateGrantedPermissions else key in grantedPermissions

    internal fun grant(key: String, isPrivate: Boolean, session: Int) {
        if (isPrivate) {
            if (session == privateSession) privateGrantedPermissions += key
        } else {
            grantedPermissions += key
        }
    }

    internal fun hostActivity(): Activity? = hostActivity as? Activity

    private fun privateProfile(): String {
        privateProfileName?.let { return it }
        val name = PRIVATE_PROFILE_PREFIX + java.util.UUID.randomUUID()
        privateJar = PrivateJar(java.util.UUID.randomUUID().toString(), ProfileStore.getInstance().getOrCreateProfile(name).cookieManager)
        privateProfileName = name
        return name
    }

    private fun endPrivateBrowsing() {
        privateGrantedPermissions.clear()
        privateSession += 1
        val name = privateProfileName
        privateProfileName = null
        val endedSession = privateJar?.session
        privateJar = null
        endedSession?.let { session -> sessionEndListeners.forEach { listener -> runCatching { listener(session) } } }
        onPrivateBrowsingEnded?.invoke()
        if (name == null || !multiProfileFeature) return
        clearPrivateProfile(name)
    }

    @SuppressLint("RequiresFeature")
    private fun clearPrivateProfile(name: String) {
        val profile = runCatching { ProfileStore.getInstance().getProfile(name) }.getOrNull() ?: return
        runCatching { profile.cookieManager.removeAllCookies { profile.cookieManager.flush() } }
        runCatching { profile.webStorage.deleteAllData() }
        runCatching { profile.geolocationPermissions.clearAll() }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
            runCatching { WebStorageCompat.deleteBrowsingData(profile.webStorage) {} }
        }
    }

    companion object {
        const val LIVE_LIMIT = 6
        private const val PRIVATE_PROFILE_PREFIX = "ardia-private-"
    }
}

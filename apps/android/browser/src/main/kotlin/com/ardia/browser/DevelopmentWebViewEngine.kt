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
    private var staleProfilesCleared = false
    internal var privateSession = 0
        private set

    @Volatile
    override var filter: PageFilter? = null

    override var onPrivateBrowsingEnded: (() -> Unit)? = null

    override var isInspectable: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            WebView.setWebContentsDebuggingEnabled(value)
        }

    override val separatesPrivatePages: Boolean by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }

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
        val page = roster.page(id) ?: WebViewPage(id, setup.isPrivate, this, setup, popup = null).also { roster.register(it, id) }
        roster.activate(id)
        return page
    }

    override fun openPopup(id: String, popup: PopupRequest): Page {
        check(!popup.isClaimed) { "This popup already has a page" }
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
        val wrapper = MutableContextWrapper(hostActivity ?: appContext)
        contextWrappers[wrapper] = Unit
        val webView = WebView(wrapper)
        if (isPrivate && separatesPrivatePages) WebViewCompat.setProfile(webView, privateProfile())
        return webView
    }

    internal fun cookieManager(isPrivate: Boolean): CookieManager {
        val name = privateProfileName
        if (isPrivate && name != null && separatesPrivatePages) {
            return runCatching { ProfileStore.getInstance().getOrCreateProfile(name).cookieManager }.getOrElse { CookieManager.getInstance() }
        }
        return CookieManager.getInstance()
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
        val store = ProfileStore.getInstance()
        if (!staleProfilesCleared) {
            staleProfilesCleared = true
            for (stale in store.allProfileNames.filter { it.startsWith(PRIVATE_PROFILE_PREFIX) }) runCatching { store.deleteProfile(stale) }
        }
        val name = PRIVATE_PROFILE_PREFIX + System.currentTimeMillis()
        store.getOrCreateProfile(name)
        privateProfileName = name
        return name
    }

    private fun endPrivateBrowsing() {
        privateGrantedPermissions.clear()
        privateSession += 1
        val name = privateProfileName
        privateProfileName = null
        onPrivateBrowsingEnded?.invoke()
        if (name == null || !separatesPrivatePages) return
        runCatching {
            val profile = ProfileStore.getInstance().getProfile(name) ?: return@runCatching
            profile.cookieManager.removeAllCookies(null)
            profile.webStorage.deleteAllData()
            profile.geolocationPermissions.clearAll()
        }
        deleteProfileWhenFree(name, attempt = 0)
    }

    private fun deleteProfileWhenFree(name: String, attempt: Int) {
        mainHandler.postDelayed({
            val deleted = runCatching { ProfileStore.getInstance().deleteProfile(name) }.isSuccess
            if (!deleted && attempt < 5) deleteProfileWhenFree(name, attempt + 1)
        }, 500L * (attempt + 1))
    }

    companion object {
        const val LIVE_LIMIT = 6
        private const val PRIVATE_PROFILE_PREFIX = "ardia-private-"
    }
}

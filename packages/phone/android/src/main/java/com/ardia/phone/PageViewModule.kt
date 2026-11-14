package com.ardia.phone

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.ardia.browser.NightShadeMode
import com.ardia.browser.PageRequest
import com.ardia.browser.PageZoom
import com.ardia.browser.ReadableContentException
import com.ardia.browser.WebsiteDataKind
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PageSetupRecord : Record {
    @Field val url: String? = null

    @Field val title: String? = null

    @Field val isPrivate: Boolean = false

    @Field val savedState: String? = null
}

class SnapshotOptionsRecord : Record {
    @Field val maxWidth: Int? = null

    @Field val quality: Int? = null

    @Field val coveredInsets: List<Double>? = null
}

class RequestAnswerRecord : Record {
    @Field val type: String = ""

    @Field val text: String? = null

    @Field val user: String? = null

    @Field val password: String? = null

    @Field val uris: List<String>? = null
}

class PageViewModule : Module() {
    private var picking: Pair<PageRequest, Promise>? = null

    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)

    override fun definition() = ModuleDefinition {
        Name("ArdiaPageView")

        Events("onPageEngineEvent")

        OnCreate {
            PhonePages.pageSink = { sendEvent("onPageEngineEvent", it) }
        }

        OnDestroy {
            PhonePages.pageSink = null
        }

        OnActivityEntersForeground {
            appContext.currentActivity?.let(PhonePages::attach)
        }

        OnActivityDestroys {
            appContext.currentActivity?.let(PhonePages::detach)
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != PICK_FILES_REQUEST) return@OnActivityResult
            val (request, promise) = picking ?: return@OnActivityResult
            picking = null
            val uris = payload.data?.let(::pickedUris).orEmpty().filter(::readable)
            request.answer(if (payload.resultCode == Activity.RESULT_OK && uris.isNotEmpty()) PageRequest.Answer.Files(uris) else PageRequest.Answer.Dismissed)
            promise.resolve(uris.isNotEmpty())
        }

        Function("capabilities") {
            val engine = PhonePages.engine(context)
            mapOf(
                "engineName" to engine.name,
                "isDevelopmentOnly" to engine.isDevelopmentOnly,
                "supportsPrivatePages" to engine.separatesPrivatePages,
                "pageZoomLevels" to PageZoom.levels,
                "pageZoomScalesTextOnly" to true,
                "snapshotsIncludeVideo" to false,
            )
        }

        Function("launchOptions") {
            val intent = appContext.currentActivity?.intent ?: return@Function null
            mapOf("pageLab" to intent.getBooleanExtra(PAGE_LAB_EXTRA, false))
        }

        AsyncFunction("openPage") { pageId: String, setup: PageSetupRecord ->
            PhonePages.open(context, pageId, PhonePages.setup(setup.url, setup.title, setup.isPrivate, setup.savedState))
            Unit
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("closePage") { pageId: String ->
            PhonePages.close(pageId)
            Unit
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("pageIds") { -> PhonePages.pageIds() }.runOnQueue(Queues.MAIN)

        AsyncFunction("pageState") { pageId: String ->
            PhonePages.page(pageId)?.let { PagePayloads.state(context, it.state.value, it.isPrivate) }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("load") { pageId: String, url: String -> PhonePages.require(pageId).load(url) }.runOnQueue(Queues.MAIN)

        AsyncFunction("reload") { pageId: String -> PhonePages.require(pageId).reload() }.runOnQueue(Queues.MAIN)

        AsyncFunction("stopLoading") { pageId: String -> PhonePages.require(pageId).stop() }.runOnQueue(Queues.MAIN)

        AsyncFunction("goBack") { pageId: String -> PhonePages.require(pageId).goBack() }.runOnQueue(Queues.MAIN)

        AsyncFunction("goForward") { pageId: String -> PhonePages.require(pageId).goForward() }.runOnQueue(Queues.MAIN)

        AsyncFunction("find") { pageId: String, text: String -> PhonePages.find(pageId, text) }.runOnQueue(Queues.MAIN)

        AsyncFunction("findNext") { pageId: String -> PhonePages.require(pageId).findNext() }.runOnQueue(Queues.MAIN)

        AsyncFunction("findPrevious") { pageId: String -> PhonePages.require(pageId).findPrevious() }.runOnQueue(Queues.MAIN)

        AsyncFunction("endFind") { pageId: String -> PhonePages.require(pageId).endFind() }.runOnQueue(Queues.MAIN)

        AsyncFunction("setPageZoom") { pageId: String, zoom: Double ->
            PhonePages.require(pageId).run {
                setPageZoom(zoom)
                state.value.pageZoom
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("zoomIn") { pageId: String ->
            PhonePages.require(pageId).run {
                zoomIn()
                state.value.pageZoom
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("zoomOut") { pageId: String ->
            PhonePages.require(pageId).run {
                zoomOut()
                state.value.pageZoom
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setDesktopSite") { pageId: String, enabled: Boolean -> PhonePages.require(pageId).setDesktopSite(enabled) }.runOnQueue(Queues.MAIN)

        AsyncFunction("download") { pageId: String, url: String -> PhonePages.require(pageId).download(url) }.runOnQueue(Queues.MAIN)

        AsyncFunction("readableContent") Coroutine { pageId: String ->
            withContext(Dispatchers.Main) {
                val page = PhonePages.require(pageId)
                try {
                    PagePayloads.readable(page.readableContent())
                } catch (unreadable: ReadableContentException) {
                    null
                }
            }
        }

        AsyncFunction("snapshot") Coroutine { pageId: String, options: SnapshotOptionsRecord ->
            withContext(Dispatchers.Main) {
                val covered = options.coveredInsets?.takeIf { it.size == 2 }?.let { it[0] to it[1] }
                PhonePages.snapshot(pageId, options.maxWidth ?: com.ardia.browser.Page.SNAPSHOT_WIDTH, options.quality ?: SNAPSHOT_QUALITY, covered)
            }
        }

        AsyncFunction("deleteSnapshots") { pageId: String ->
            PhonePages.engine(context)
            PhonePages.snapshots.delete(pageId)
        }

        AsyncFunction("loadHtml") { pageId: String, html: String, baseUrl: String -> PhonePages.loadHtml(pageId, html, baseUrl) }.runOnQueue(Queues.MAIN)

        AsyncFunction("evaluate") Coroutine { pageId: String, script: String ->
            withContext(Dispatchers.Main) { PhonePages.evaluate(pageId, script) }
        }

        AsyncFunction("scrollPosition") { pageId: String -> PhonePages.scrollPosition(pageId) }.runOnQueue(Queues.MAIN)

        AsyncFunction("discardBackgroundPages") { keeping: String? -> PhonePages.discardBackgroundPages(keeping) }.runOnQueue(Queues.MAIN)

        AsyncFunction("livePageIds") { -> PhonePages.livePageIds() }.runOnQueue(Queues.MAIN)

        AsyncFunction("saveState") { pageId: String -> PhonePages.saveState(pageId) }.runOnQueue(Queues.MAIN)

        AsyncFunction("answerRequest") { pageId: String, requestId: String, answer: RequestAnswerRecord, promise: Promise ->
            val request = PhonePages.page(pageId)?.request?.value?.takeIf { it.id.toString() == requestId && !it.isAnswered }
            if (request == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            when (val parsed = PagePayloads.answer(answer.type, answer.text, answer.user, answer.password, answer.uris)) {
                PagePayloads.Answer.PickFiles -> pickFiles(request, promise)
                is PagePayloads.Answer.Page -> {
                    val kind = request.kind
                    if (parsed.answer == PageRequest.Answer.Accepted && kind is PageRequest.Kind.Permission) {
                        askAndroid(PagePayloads.androidPermissions(kind.permission)) { granted ->
                            request.answer(if (granted) PageRequest.Answer.Accepted else PageRequest.Answer.Dismissed)
                            promise.resolve(granted)
                        }
                    } else {
                        request.answer(parsed.answer)
                        promise.resolve(true)
                    }
                }
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("openPopup") { pageId: String, popupId: String -> PhonePages.openPopup(context, pageId, popupId) != null }.runOnQueue(Queues.MAIN)

        AsyncFunction("dismissPopup") { popupId: String -> PhonePages.dismissPopup(popupId) }.runOnQueue(Queues.MAIN)

        AsyncFunction("exitFullscreen") { pageId: String ->
            PhonePages.page(pageId)?.fullscreen?.value?.exit()
            Unit
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("endPrivateSession") { -> PhonePages.endPrivateSession() }.runOnQueue(Queues.MAIN)

        AsyncFunction("nightShade") { host: String?, isPrivate: Boolean? ->
            PhonePages.engine(context)
            val preferences = PhonePages.sitePreferences
            mapOf(
                "defaultMode" to preferences.defaultNightShade.raw,
                "siteMode" to host?.let { preferences.siteNightShade(it, isPrivate == true)?.raw },
                "mode" to preferences.nightShade(host?.let(PhoneSitePreferences::siteKey), isPrivate == true).raw,
            )
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setNightShade") { mode: String?, host: String?, isPrivate: Boolean? ->
            val engine = PhonePages.engine(context)
            val parsed = mode?.let { PhoneSitePreferences.mode(it) ?: throw PagePayloads.badArgs("Unknown Night Shade mode $it") }
            if (host == null) {
                PhonePages.sitePreferences.defaultNightShade = parsed ?: NightShadeMode.Disabled
            } else {
                PhonePages.sitePreferences.setSiteNightShade(host, isPrivate == true, parsed)
            }
            engine.refreshSitePreferences()
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setOpensLinksInApps") { host: String, opens: Boolean ->
            PhonePages.engine(context)
            PhonePages.sitePreferences.setOpensLinksInApps(host, opens)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("opensLinksInApps") { host: String ->
            PhonePages.engine(context)
            PhonePages.sitePreferences.opensLinksInApps(PhoneSitePreferences.siteKey(host), false)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("clearWebsiteData") Coroutine { kinds: List<String> ->
            val parsed = kinds.map {
                when (it) {
                    "cache" -> WebsiteDataKind.Cache
                    "cookiesAndSiteData" -> WebsiteDataKind.CookiesAndSiteData
                    else -> throw PagePayloads.badArgs("Unknown website data kind $it")
                }
            }.toSet()
            withContext(Dispatchers.Main) { PhonePages.engine(context).clearWebsiteData(parsed) }
        }

        AsyncFunction("setInspectable") { inspectable: Boolean -> PhonePages.engine(context).isInspectable = inspectable }.runOnQueue(Queues.MAIN)

        View(PageView::class) {
            Events("onPageEvent")

            Prop("pageId") { view: PageView, pageId: String -> view.pageId = pageId }

            Prop("initialUrl") { view: PageView, url: String? -> view.initialUrl = url }

            Prop("title") { view: PageView, title: String? -> view.title = title }

            Prop("isPrivate") { view: PageView, isPrivate: Boolean? -> view.isPrivate = isPrivate == true }

            Prop("savedState") { view: PageView, savedState: String? -> view.savedState = savedState }

            Prop("toneInsets") { view: PageView, insets: List<Double>? ->
                view.toneInsets = insets?.takeIf { it.size == 2 }?.let { it[0] to it[1] } ?: (0.0 to 0.0)
            }

            OnViewDidUpdateProps { view -> view.bind() }

            OnViewDestroys { view -> view.unbind() }

            AsyncFunction("loadUrl") { view: PageView, url: String -> view.page?.load(url) }

            AsyncFunction("goBack") { view: PageView -> view.page?.goBack() == true }

            AsyncFunction("goForward") { view: PageView -> view.page?.goForward() == true }

            AsyncFunction("reload") { view: PageView -> view.page?.reload() }

            AsyncFunction("stopLoading") { view: PageView -> view.page?.stop() }
        }
    }

    private fun askAndroid(permissions: Array<String>, done: (Boolean) -> Unit) {
        val manager = appContext.permissions
        if (manager == null) {
            done(false)
            return
        }
        manager.askForPermissions({ results ->
            val granted = permissions.any { results[it]?.status == PermissionsStatus.GRANTED }
            appContext.mainQueue.launch { done(granted) }
        }, *permissions)
    }

    private fun pickFiles(request: PageRequest, promise: Promise) {
        val kind = request.kind as? PageRequest.Kind.FileChooser
        val activity = appContext.currentActivity
        if (kind == null || activity == null || picking != null) {
            request.dismiss()
            promise.resolve(false)
            return
        }
        val types = kind.acceptTypes.filter { it.contains('/') }.ifEmpty { listOf("*/*") }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if (types.size == 1) types.first() else "*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, kind.allowsMultiple)
        if (types.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
        picking = request to promise
        try {
            activity.startActivityForResult(intent, PICK_FILES_REQUEST)
        } catch (missing: android.content.ActivityNotFoundException) {
            picking = null
            request.dismiss()
            promise.resolve(false)
        }
    }

    private fun pickedUris(data: Intent): List<Uri> {
        val clip = data.clipData
        if (clip != null) return List(clip.itemCount) { clip.getItemAt(it).uri }.filterNotNull()
        return listOfNotNull(data.data)
    }

    private fun readable(uri: Uri): Boolean = runCatching {
        context.contentResolver.openFileDescriptor(uri, "r")?.use { true } ?: false
    }.getOrDefault(false)

    companion object {
        const val PAGE_LAB_EXTRA = "com.ardia.phone.PAGE_LAB"
        private const val PICK_FILES_REQUEST = 47_201
        private const val SNAPSHOT_QUALITY = 82
    }
}

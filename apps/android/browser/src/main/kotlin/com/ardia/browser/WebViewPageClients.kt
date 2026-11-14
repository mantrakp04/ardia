package com.ardia.browser

import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.HttpAuthHandler
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

internal class WebViewPageClient(private val page: WebViewPage) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (view !== page.webViewOrNull) return true
        val url = request.url.toString()
        val isMainFrame = request.isForMainFrame
        when (val route = ExternalLinks.route(url, isMainFrame)) {
            LinkRoute.Blocked -> return true
            is LinkRoute.External -> {
                if (ExternalLinks.asksBeforeOpening(isMainFrame, request.hasGesture())) page.askToOpenExternal(url, route)
                return true
            }
            LinkRoute.Web -> Unit
        }
        if (!isMainFrame) return false
        if (request.hasGesture() && !request.isRedirect && page.opensInApp(url)) return true
        page.startRendererNavigation(view, url, if (request.isRedirect) null else page.rendererNavigationKind(request.hasGesture()))
        return false
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val isMainFrame = request.isForMainFrame
        val uri = request.url
        if (isMainFrame) {
            page.filterPageUrl = uri.toString()
            page.startDocumentRequests()
            page.noteRequest(uri.scheme, uri.host)
        } else if (!page.sawInsecureContent && uri.scheme == "http" && BrowserUrl.isSecure(page.filterPageUrl)) {
            page.sawInsecureContent = true
            page.noteInsecureContent()
        }
        if (!isMainFrame) page.noteRequest(uri.scheme, uri.host)
        val filter = page.engine.filterFor(page.isPrivate) ?: return null
        val requestUrl = uri.toString()
        val blocked = try {
            filter.blocks(requestUrl, if (isMainFrame) requestUrl else page.filterPageUrl, isMainFrame)
        } catch (error: RuntimeException) {
            false
        }
        if (!blocked) return null
        page.countBlocked()
        return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = page.pageStarted(view, url)

    override fun onPageFinished(view: WebView, url: String) = page.pageFinished(view, url)

    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) = page.historyUpdated(view, url, isReload)

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        if (error.errorCode == ERROR_UNSUPPORTED_SCHEME || error.description?.contains("ERR_ABORTED") == true) return
        page.failed(view, request.url.toString(), NetworkFailure.fromWebViewError(error.errorCode, page.engine.isOnline()))
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        val pageUrl = page.filterPageUrl ?: return
        if (BrowserUrl.withoutFragment(error.url) == BrowserUrl.withoutFragment(pageUrl)) page.failed(view, error.url, NetworkFailure.NotPrivate)
    }

    override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
        if (view !== page.webViewOrNull) {
            handler.cancel()
            return
        }
        val key = "$host#$realm"
        val kind = PageRequest.Kind.HttpAuthentication(
            realm = realm.ifEmpty { null },
            isProxy = false,
            failedBefore = key in page.answeredSignIns,
            isSecure = page.signInIsSecure(host),
        )
        page.ask(kind, host) { answer ->
            if (answer is PageRequest.Answer.Credential) {
                page.answeredSignIns += key
                handler.proceed(answer.user, answer.password)
            } else {
                handler.cancel()
            }
        }
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        page.rendererGone(view, detail.didCrash())
        return true
    }
}

internal class WebViewPageChromeClient(private val page: WebViewPage) : WebChromeClient() {
    private var permissionRequest: Pair<PermissionRequest, PageRequest>? = null
    private var locationRequest: PageRequest? = null

    override fun onProgressChanged(view: WebView, newProgress: Int) = page.progressChanged(view, newProgress)

    override fun onReceivedTitle(view: WebView, title: String?) = page.titleReceived(view, title)

    override fun onReceivedIcon(view: WebView, icon: Bitmap?) = page.iconReceived(view, icon)

    override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
        page.ask(PageRequest.Kind.Alert(message.orEmpty()), frameHost(url)) { result.confirm() }
        return true
    }

    override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
        page.ask(PageRequest.Kind.Confirm(message.orEmpty()), frameHost(url)) { answer ->
            if (answer == PageRequest.Answer.Accepted) result.confirm() else result.cancel()
        }
        return true
    }

    override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean {
        page.ask(PageRequest.Kind.Prompt(message.orEmpty(), defaultValue.orEmpty()), frameHost(url)) { answer ->
            if (answer is PageRequest.Answer.Text) result.confirm(answer.text) else result.cancel()
        }
        return true
    }

    override fun onJsBeforeUnload(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
        result.confirm()
        return true
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        val resources = request.resources.toSet()
        val video = PermissionRequest.RESOURCE_VIDEO_CAPTURE in resources
        val audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE in resources
        if (!video && !audio) {
            if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID in resources && !page.isPrivate) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID))
            } else {
                request.deny()
            }
            return
        }
        val permission = when {
            video && audio -> SitePermission.CameraAndMicrophone
            video -> SitePermission.Camera
            else -> SitePermission.Microphone
        }
        val asked = listOfNotNull(
            PermissionRequest.RESOURCE_VIDEO_CAPTURE.takeIf { video },
            PermissionRequest.RESOURCE_AUDIO_CAPTURE.takeIf { audio },
        ).toTypedArray()
        val origin = request.origin.toString()
        val key = "$origin#${permission.name}"
        val engine = page.engine
        if (engine.isGranted(key, page.isPrivate)) {
            request.grant(asked)
            return
        }
        val session = engine.privateSession
        val web = page.webViewOrNull
        lateinit var asking: PageRequest
        asking = page.ask(PageRequest.Kind.Permission(permission), originHost(origin)) { answer ->
            if (permissionRequest?.second === asking) permissionRequest = null
            runCatching {
                if (answer == PageRequest.Answer.Accepted && web != null && page.webViewOrNull === web) {
                    engine.grant(key, page.isPrivate, session)
                    request.grant(asked)
                } else {
                    request.deny()
                }
            }
        }
        permissionRequest = request to asking
    }

    override fun onPermissionRequestCanceled(request: PermissionRequest) {
        val pending = permissionRequest ?: return
        if (pending.first === request) page.withdraw(pending.second)
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
        val key = "$origin#${SitePermission.Location.name}"
        val engine = page.engine
        if (engine.isGranted(key, page.isPrivate)) {
            callback.invoke(origin, true, false)
            return
        }
        val session = engine.privateSession
        val web = page.webViewOrNull
        locationRequest = page.ask(PageRequest.Kind.Permission(SitePermission.Location), originHost(origin)) { answer ->
            locationRequest = null
            val allowed = answer == PageRequest.Answer.Accepted && web != null && page.webViewOrNull === web
            if (allowed) engine.grant(key, page.isPrivate, session)
            callback.invoke(origin, allowed, false)
        }
    }

    override fun onGeolocationPermissionsHidePrompt() {
        page.withdraw(locationRequest)
    }

    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
        val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }.filter { it.isNotEmpty() }
        val kind = PageRequest.Kind.FileChooser(types, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE, params.isCaptureEnabled)
        page.ask(kind, page.currentHost()) { answer ->
            val accepted = (answer as? PageRequest.Answer.Files)?.uris?.filter { page.engine.acceptsUpload(it.toString()) }
            callback.onReceiveValue(accepted?.takeIf { it.isNotEmpty() }?.toTypedArray())
        }
        return true
    }

    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
        if (view !== page.webViewOrNull) return false
        val hit = view.hitTestResult
        val url = hit.extra?.takeIf { hit.type == WebView.HitTestResult.SRC_ANCHOR_TYPE }
        if (url != null) {
            when (val route = ExternalLinks.route(url)) {
                LinkRoute.Blocked -> return false
                is LinkRoute.External -> {
                    page.askToOpenExternal(url, route)
                    return false
                }
                LinkRoute.Web -> Unit
            }
        }
        page.emit(PageEvent.OpenWindow(PopupRequest(url, isUserGesture, page.isPrivate, page.id, resultMsg)))
        return true
    }

    override fun onCloseWindow(window: WebView) {
        if (window === page.webViewOrNull) page.emit(PageEvent.CloseRequested)
    }

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        if (page.mutableFullscreen.value != null) {
            callback.onCustomViewHidden()
            return
        }
        page.mutableFullscreen.value = FullscreenVideo(view) {
            if (page.mutableFullscreen.value?.view === view) {
                page.mutableFullscreen.value = null
                callback.onCustomViewHidden()
            }
        }
    }

    override fun onHideCustomView() {
        page.mutableFullscreen.value = null
    }

    override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

    private fun frameHost(url: String?): String = url?.let(BrowserUrl::rawHost).orEmpty()

    private fun originHost(origin: String): String = BrowserUrl.rawHost(origin) ?: origin
}

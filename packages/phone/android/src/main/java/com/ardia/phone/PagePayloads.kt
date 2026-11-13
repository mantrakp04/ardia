package com.ardia.phone

import android.content.Context
import android.net.Uri
import com.ardia.browser.ExternalApp
import com.ardia.browser.FindResult
import com.ardia.browser.NetworkFailure
import com.ardia.browser.PageColors
import com.ardia.browser.PageLoadFailure
import com.ardia.browser.PageRequest
import com.ardia.browser.PageSecurity
import com.ardia.browser.PageState
import com.ardia.browser.PressTarget
import com.ardia.browser.ReadableContent
import com.ardia.browser.ScrollDirection
import com.ardia.browser.SitePermission
import com.ardia.browser.VisitKind
import expo.modules.kotlin.exception.CodedException

object PagePayloads {
    fun state(context: Context, state: PageState, isPrivate: Boolean): Map<String, Any?> = mapOf(
        "url" to state.url,
        "title" to state.title,
        "progress" to state.progress.toDouble(),
        "isLoading" to state.isLoading,
        "canGoBack" to state.canGoBack,
        "canGoForward" to state.canGoForward,
        "faviconUrl" to state.faviconUrl,
        "themeColor" to state.themeColor?.let(PageColors::hex),
        "backgroundColor" to state.backgroundColor?.let(PageColors::hex),
        "security" to security(state.security),
        "failure" to state.failure?.let { failure(context, it) },
        "pageZoom" to state.pageZoom,
        "isDesktopSite" to state.isDesktopSite,
        "scrollDirection" to if (state.scrollDirection == ScrollDirection.Down) "down" else "up",
        "isScrolledToTop" to state.isScrolledToTop,
        "blockedRequests" to state.blockedRequests,
        "isLive" to state.isLive,
        "isPrivate" to isPrivate,
    )

    fun security(security: PageSecurity): String = when (security) {
        PageSecurity.None -> "none"
        PageSecurity.Secure -> "secure"
        PageSecurity.Mixed -> "mixed"
        PageSecurity.Insecure -> "insecure"
    }

    fun failure(context: Context, failure: PageLoadFailure): Map<String, Any?> = mapOf(
        "kind" to if (failure is PageLoadFailure.Crashed) "crashed" else "network",
        "reason" to (failure as? PageLoadFailure.Network)?.reason?.let(::networkReason),
        "title" to failure.title(context),
        "message" to failure.message(context),
    )

    fun networkReason(reason: NetworkFailure): String = when (reason) {
        NetworkFailure.Offline -> "offline"
        NetworkFailure.HostNotFound -> "hostNotFound"
        NetworkFailure.TimedOut -> "timedOut"
        NetworkFailure.ConnectionLost -> "connectionLost"
        NetworkFailure.NotPrivate -> "notPrivate"
        NetworkFailure.Other -> "other"
    }

    fun find(result: FindResult?): Map<String, Any?>? = result?.let {
        mapOf("query" to it.query, "activeIndex" to it.activeIndex, "total" to it.total, "isDone" to it.isDone)
    }

    fun visitKind(kind: VisitKind): String = when (kind) {
        VisitKind.Typed -> "typed"
        VisitKind.Link -> "link"
        VisitKind.BackForward -> "backForward"
        VisitKind.Restored -> "restored"
        VisitKind.Redirect -> "redirect"
        VisitKind.SameDocument -> "sameDocument"
    }

    fun request(context: Context, request: PageRequest): Map<String, Any?> {
        val base = mapOf(
            "id" to request.id.toString(),
            "host" to request.host,
            "title" to request.title(context),
            "message" to request.message(context),
        )
        val kind: Map<String, Any?> = when (val kind = request.kind) {
            is PageRequest.Kind.Alert -> mapOf("kind" to "alert", "text" to kind.message)
            is PageRequest.Kind.Confirm -> mapOf("kind" to "confirm", "text" to kind.message)
            is PageRequest.Kind.Prompt -> mapOf("kind" to "prompt", "text" to kind.message, "defaultText" to kind.defaultText)
            is PageRequest.Kind.OpenExternal -> mapOf("kind" to "openExternal", "url" to kind.url, "app" to externalApp(kind.app))
            is PageRequest.Kind.HttpAuthentication -> mapOf(
                "kind" to "httpAuthentication",
                "realm" to kind.realm,
                "isProxy" to kind.isProxy,
                "failedBefore" to kind.failedBefore,
                "isSecure" to kind.isSecure,
            )
            is PageRequest.Kind.Permission -> mapOf("kind" to "permission", "permission" to permission(kind.permission))
            is PageRequest.Kind.FileChooser -> mapOf(
                "kind" to "fileChooser",
                "acceptTypes" to kind.acceptTypes,
                "allowsMultiple" to kind.allowsMultiple,
                "prefersCapture" to kind.prefersCapture,
            )
        }
        return base + kind
    }

    fun externalApp(app: ExternalApp): String = when (app) {
        ExternalApp.Phone -> "phone"
        ExternalApp.Email -> "email"
        ExternalApp.Messages -> "messages"
        ExternalApp.Maps -> "maps"
        ExternalApp.Store -> "store"
        ExternalApp.Other -> "other"
    }

    fun permission(permission: SitePermission): String = when (permission) {
        SitePermission.Camera -> "camera"
        SitePermission.Microphone -> "microphone"
        SitePermission.CameraAndMicrophone -> "cameraAndMicrophone"
        SitePermission.Location -> "location"
    }

    fun androidPermissions(permission: SitePermission): Array<String> = when (permission) {
        SitePermission.Camera -> arrayOf(android.Manifest.permission.CAMERA)
        SitePermission.Microphone -> arrayOf(android.Manifest.permission.RECORD_AUDIO)
        SitePermission.CameraAndMicrophone -> arrayOf(android.Manifest.permission.CAMERA, android.Manifest.permission.RECORD_AUDIO)
        SitePermission.Location -> arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    sealed interface Answer {
        data class Page(val answer: PageRequest.Answer) : Answer

        data object PickFiles : Answer
    }

    fun answer(type: String, text: String?, user: String?, password: String?, uris: List<String>?): Answer = when (type) {
        "dismiss" -> Answer.Page(PageRequest.Answer.Dismissed)
        "accept" -> Answer.Page(PageRequest.Answer.Accepted)
        "text" -> Answer.Page(PageRequest.Answer.Text(text ?: throw badArgs("A text answer needs text")))
        "credential" -> Answer.Page(
            PageRequest.Answer.Credential(user ?: throw badArgs("A credential answer needs user"), password ?: throw badArgs("A credential answer needs password")),
        )
        "files" -> Answer.Page(PageRequest.Answer.Files((uris ?: throw badArgs("A files answer needs uris")).map(Uri::parse)))
        "pickFiles" -> Answer.PickFiles
        else -> throw badArgs("Unknown answer type $type")
    }

    fun pressTarget(target: PressTarget): Map<String, Any?> = when (target) {
        is PressTarget.Link -> mapOf("kind" to "link", "url" to target.url, "text" to target.text)
        is PressTarget.Image -> mapOf("kind" to "image", "url" to target.url, "linkUrl" to target.linkUrl)
    }

    fun readable(content: ReadableContent): Map<String, Any?> = mapOf(
        "url" to content.url,
        "title" to content.title,
        "siteName" to content.siteName,
        "byline" to content.byline,
        "excerpt" to content.excerpt,
        "leadImage" to content.leadImage,
        "language" to content.language,
        "paragraphs" to content.paragraphs,
        "html" to content.html,
        "wordCount" to content.wordCount,
        "isArticle" to content.isArticle,
    )

    fun badArgs(message: String) = CodedException("ERR_BAD_ARGS", message, null)
}

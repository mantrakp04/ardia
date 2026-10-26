import AppKit
import ExpoModulesCore
import WebKit

public class WebKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaWebKit")
    Events("onDownload", "onPermission", "onPermissionDismissed")

    OnCreate {
      WebKitHub.shared.events = { [weak self] name, payload in self?.sendEvent(name, payload) }
    }

    Function("prepareTransfer") { (key: String) in WebKitHub.shared.prepareTransfer(key) }
    Function("releaseTransfer") { (key: String) in WebKitHub.shared.releaseTransfer(key) }
    AsyncFunction("resolvePermission") { (id: String, result: String, remember: Bool?) in
      WebKitHub.shared.resolvePermission(id, result: result, remember: remember ?? false)
    }.runOnQueue(.main)
    AsyncFunction("downloadCommand") { (action: String, id: String) in WebKitHub.shared.downloads.command(action, id: id) }.runOnQueue(.main)
    AsyncFunction("externalAppAllowances") { (profile: String) in WebKitHub.shared.externalAppAllowances(profile: profile) }
      .runOnQueue(.main)
    AsyncFunction("removeExternalAppAllowance") { (profile: String, origin: String, scheme: String) in
      WebKitHub.shared.removeExternalAppAllowance(profile: profile, origin: origin, scheme: scheme)
    }.runOnQueue(.main)
    AsyncFunction("removeDownloadStaging") { (path: String, uuid: String, folder: String) in
      WebKitDownloads.removeStaging(path, uuid: uuid, folder: folder)
    }
      .runOnQueue(.main)
    AsyncFunction("endPrivateSession") { (session: String) in WebKitHub.shared.endPrivateSession(session) }.runOnQueue(.main)
    AsyncFunction("sitePermissions") { (profile: String, origin: String) in
      WebKitHub.shared.sitePermissions(profile: profile, origin: origin)
    }.runOnQueue(.main)
    AsyncFunction("setSitePermission") { (profile: String, origin: String, kind: String, value: String) in
      WebKitHub.shared.setSitePermission(profile: profile, origin: origin, kind: kind, value: value)
    }.runOnQueue(.main)
    AsyncFunction("resolveExternalApp") { (id: String, open: Bool, remember: Bool?) in
      WebKitHub.shared.resolveExternalApp(id, open: open, remember: remember ?? false)
    }.runOnQueue(.main)
    AsyncFunction("clearBrowsingData") { (profile: String, types: [String], since: Double?, promise: Promise) in
      WebKitHub.shared.clearBrowsingData(profile: profile, types: types, since: since ?? 0) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("deleteProfileData") { (profile: String, promise: Promise) in
      WebKitHub.shared.deleteProfileData(profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("info") { () -> [String: Any] in
      [
        "safariVersion": WebKitHub.safariVersion, "userAgentSuffix": "Version/\(WebKitHub.safariVersion) Safari/605.1.15",
        "passkeys": WebKitHub.passkeysEntitled,
      ]
    }.runOnQueue(.main)

    View(WebKitTabView.self) {
      Events(CefWebView.events)

      Prop("url") { (view: WebKitTabView, url: String?) in view.tab.initialURL = url }
      Prop("profile") { (view: WebKitTabView, profile: String?) in view.tab.profile = profile ?? "" }
      Prop("adoptId") { (view: WebKitTabView, id: String?) in view.tab.adoptId = id }
      Prop("transferKey") { (view: WebKitTabView, key: String?) in view.tab.transferKey = key }
      Prop("visible") { (view: WebKitTabView, visible: Bool?) in view.tab.visible = visible ?? true }
      Prop("warm") { (view: WebKitTabView, warm: Bool?) in view.tab.warm = warm ?? false }
      Prop("pageBackgroundColor") { (view: WebKitTabView, color: NSColor?) in view.tab.pageBackgroundColor = color }

      AsyncFunction("loadUrl") { (view: WebKitTabView, url: String, userInitiated: Bool?) in
        view.tab.loadURL(url, userInitiated: userInitiated ?? false)
      }.runOnQueue(.main)
      AsyncFunction("goBack") { (view: WebKitTabView) in view.tab.goBack() }.runOnQueue(.main)
      AsyncFunction("goForward") { (view: WebKitTabView) in view.tab.goForward() }.runOnQueue(.main)
      AsyncFunction("goToOffset") { (view: WebKitTabView, offset: Int) in view.tab.go(toHistoryOffset: offset) }.runOnQueue(.main)
      AsyncFunction("reload") { (view: WebKitTabView) in view.tab.reload() }.runOnQueue(.main)
      AsyncFunction("forceReload") { (view: WebKitTabView) in view.tab.reloadIgnoringCache() }.runOnQueue(.main)
      AsyncFunction("stopLoading") { (view: WebKitTabView) in view.tab.stopLoading() }.runOnQueue(.main)
      AsyncFunction("focus") { (view: WebKitTabView) in view.tab.focusPage() }.runOnQueue(.main)
      AsyncFunction("setMuted") { (view: WebKitTabView, muted: Bool) in view.tab.setMuted(muted) }.runOnQueue(.main)
      AsyncFunction("zoomStep") { (view: WebKitTabView, direction: Int) in view.tab.zoomStep(direction) }.runOnQueue(.main)
      AsyncFunction("find") { (view: WebKitTabView, text: String, forward: Bool, findNext: Bool) in
        view.tab.find(text, forward: forward, findNext: findNext)
      }.runOnQueue(.main)
      AsyncFunction("stopFinding") { (view: WebKitTabView, clear: Bool) in view.tab.stopFinding(clear) }.runOnQueue(.main)
      AsyncFunction("print") { (view: WebKitTabView) in view.tab.print() }.runOnQueue(.main)
      AsyncFunction("runPageCommand") { (view: WebKitTabView, name: String) in view.tab.runPageCommand(name) }.runOnQueue(.main)
      AsyncFunction("showDevTools") { (view: WebKitTabView, panel: String?) in }.runOnQueue(.main)
      AsyncFunction("executeJavaScript") { (view: WebKitTabView, code: String) in view.tab.executeJavaScript(code) }.runOnQueue(.main)
      AsyncFunction("evaluate") { (view: WebKitTabView, code: String, promise: Promise) in
        view.tab.evaluate(code) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("navigationEntries") { (view: WebKitTabView) in view.tab.navigationEntries() }.runOnQueue(.main)
      AsyncFunction("capturePicture") { (view: WebKitTabView, scale: Double, promise: Promise) in
        view.tab.capturePicture(scale) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("copyRegionToPasteboard") { (view: WebKitTabView, rect: [Double], promise: Promise) in
        view.tab.copyPicture(of: rect) { promise.resolve(writePictureToPasteboard($0)) }
      }.runOnQueue(.main)
      AsyncFunction("downloadFavicon") { (view: WebKitTabView, url: String, promise: Promise) in
        view.tab.downloadFavicon(url) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadImage") { (view: WebKitTabView, url: String, maxPixels: Int, promise: Promise) in
        view.tab.downloadFavicon(url) { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("mediaCommand") { (view: WebKitTabView, action: String, seconds: Double?) in
        view.tab.mediaCommand(action, seconds: seconds ?? 0)
      }.runOnQueue(.main)
      AsyncFunction("requestPictureInPicture") { (view: WebKitTabView, clickAt: Double?, control: Int?, promise: Promise) in
        view.tab.setPictureInPicture(true) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("takeControlPress") { (view: WebKitTabView, clickAt: Double?, control: Int?) -> Bool in true }.runOnQueue(.main)
      AsyncFunction("exitPictureInPicture") { (view: WebKitTabView) in view.tab.setPictureInPicture(false) { _ in } }.runOnQueue(.main)

      AsyncFunction("getSecurityInfo") { (view: WebKitTabView) in view.tab.securityInfo() }.runOnQueue(.main)
      AsyncFunction("openBlockedPopup") { (view: WebKitTabView, id: String, always: Bool?) in }.runOnQueue(.main)
      AsyncFunction("clearSiteData") { (view: WebKitTabView, promise: Promise) in
        view.tab.clearSiteData { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("resolvePasswordPrompt") { (view: WebKitTabView, action: String, username: String?, password: String?) in }
        .runOnQueue(.main)
      AsyncFunction("resolveAutofillPrompt") { (view: WebKitTabView, promptId: Int, action: String) in }.runOnQueue(.main)
      AsyncFunction("executeExtensionAction") { (view: WebKitTabView, extensionId: String) -> String? in nil }.runOnQueue(.main)
      AsyncFunction("resolveDisplayMedia") { (view: WebKitTabView, id: String, sourceId: String?, audio: Bool) in }.runOnQueue(.main)
      AsyncFunction("mediaCaptureSourceId") { (view: WebKitTabView) -> String? in nil }.runOnQueue(.main)
      AsyncFunction("notificationAction") { (view: WebKitTabView, id: String, action: String) in }.runOnQueue(.main)
      AsyncFunction("resolveUnresponsive") { (view: WebKitTabView, terminate: Bool) in }.runOnQueue(.main)
      AsyncFunction("discard") { (view: WebKitTabView, unload: Bool?) in "unsupported" }.runOnQueue(.main)
      AsyncFunction("setFrozen") { (view: WebKitTabView, frozen: Bool) in }.runOnQueue(.main)

      OnViewDidUpdateProps { (view: WebKitTabView) in view.propsDidUpdate() }
    }
  }
}

final class WebKitTabView: ExpoView, WebKitTabDelegate {
  let tab = WebKitTab(frame: .zero)

  let onNavigationChange = EventDispatcher()
  let onProgress = EventDispatcher()
  let onFavicon = EventDispatcher()
  let onMedia = EventDispatcher()
  let onNowPlaying = EventDispatcher()
  let onMediaAccess = EventDispatcher()
  let onOpenWindow = EventDispatcher()
  let onPopupBlocked = EventDispatcher()
  let onFindResult = EventDispatcher()
  let onFullscreen = EventDispatcher()
  let onStatus = EventDispatcher()
  let onCrashed = EventDispatcher()
  let onUnresponsive = EventDispatcher()
  let onResponsive = EventDispatcher()
  let onLoadError = EventDispatcher()
  let onSecurity = EventDispatcher()
  let onZoom = EventDispatcher()
  let onContentBlocked = EventDispatcher()
  let onDownloadNavigation = EventDispatcher()
  let onNotification = EventDispatcher()
  let onNotificationClose = EventDispatcher()
  let onPictureInPicture = EventDispatcher()
  let onActivateRequest = EventDispatcher()
  let onDisplayMediaRequest = EventDispatcher()
  let onWindowClose = EventDispatcher()
  let onCommand = EventDispatcher()
  let onPageFocus = EventDispatcher()
  let onPageMessage = EventDispatcher()
  let onReady = EventDispatcher()
  let onDiscarded = EventDispatcher()
  let onPasswordPrompt = EventDispatcher()
  let onAutofillPrompt = EventDispatcher()
  let onTabStrip = EventDispatcher()
  let onExternalApp = EventDispatcher()
  let onPreferredSize = EventDispatcher()

  private var propsReady = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    tab.delegate = self
    wantsLayer = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    tab.frame = bounds
  }

  func propsDidUpdate() {
    guard !propsReady else { return }
    propsReady = true
    tab.frame = bounds
    addSubview(tab)
    tab.start()
  }

  deinit {
    let tab = self.tab
    if Thread.isMainThread { tab.close() } else { DispatchQueue.main.async { tab.close() } }
  }

  func webKitTab(_ tab: WebKitTab, event name: String, payload: [String: Any]) {
    switch name {
    case "navigation": onNavigationChange(payload)
    case "progress": onProgress(payload)
    case "favicon": onFavicon(payload)
    case "media": onMedia(payload)
    case "nowPlaying": onNowPlaying(payload)
    case "mediaAccess": onMediaAccess(payload)
    case "openWindow": onOpenWindow(payload)
    case "find": onFindResult(payload)
    case "status": onStatus(payload)
    case "crashed": onCrashed(payload)
    case "loadError": onLoadError(payload)
    case "security": onSecurity(payload)
    case "zoom": onZoom(payload)
    case "downloadNavigation": onDownloadNavigation(payload)
    case "pictureInPicture": onPictureInPicture(payload)
    case "windowClose": onWindowClose(payload)
    case "focus": onPageFocus(payload)
    case "pageMessage": onPageMessage(payload)
    case "ready": onReady(payload)
    case "externalApp": onExternalApp(payload)
    default: break
    }
  }
}

import AppKit
import ExpoModulesCore
import WebKit

public class WebKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaWebKit")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      WebKitModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)

    View(WebKitTabView.self) {
      Events(PageEvents.channel)

      Prop("pageEvents") { (view: WebKitTabView, names: [String]?) in view.pageEvents = Set(names ?? []) }

      Prop("url") { (view: WebKitTabView, url: String?) in view.tab.initialURL = url }
      Prop("profile") { (view: WebKitTabView, profile: String?) in view.tab.profile = profile ?? "" }
      Prop("adoptId") { (view: WebKitTabView, id: String?) in view.tab.adoptId = id }
      Prop("tabId") { (view: WebKitTabView, tabId: String?) in view.tab.transferKey = tabId }
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
      AsyncFunction("pageCookies") { (view: WebKitTabView, urls: [String]) -> [[String: Any]] in [] }.runOnQueue(.main)
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
  static let calls = CallTable(domain: "webKit", handlers: [
    "removeDownloadStaging": { args, reply in
      reply.ok(WebKitDownloads.removeStaging(args.text("path"), uuid: args.text("uuid"), folder: args.text("folder")))
    },
    "endPrivateSession": { args, reply in
      WebKitHub.shared.endPrivateSession(args.text("session"))
      reply.ok()
    },
    "cookieStoreKey": { args, reply in reply.ok(WebKitHub.shared.storeKey(args.profile)) },
    "importCookies": { args, reply in
      let cookies = args.list("cookies").compactMap { $0 as? [String: Any] }
      WebKitHub.shared.importCookies(cookies, profile: args.profile, storeKey: args.text("storeKey")) { reply.ok($0) }
    },
    "passkeyAccess": { _, reply in reply.ok(WebKitPasskeys.access()) },
    "requestPasskeyAccess": { _, reply in WebKitPasskeys.requestAccess { reply.ok($0) } },
  ].merging(LaunchConfig.shared.testInstance ? testInstanceCalls : [:]) { call, _ in call })

  private static let testInstanceCalls: [String: CallHandler] = [
    "devStoreExists": { args, reply in WebKitHub.shared.storeExists(args.profile) { reply.ok($0) } },
    "devHoldStore": { args, reply in
      WebKitHub.shared.holdStoreForTest(args.profile)
      reply.ok()
    },
    "devTouchStore": { args, reply in WebKitHub.shared.touchStore(args.profile) { reply.ok($0) } },
  ]
}

final class WebKitTabView: ExpoView, WebKitTabDelegate {
  let tab = WebKitTab(frame: .zero)
  let onPageEvent = EventDispatcher()
  var pageEvents: Set<String> = []


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
    PageEvents.send(onPageEvent, wanted: pageEvents, name: name, payload: payload)
  }
}

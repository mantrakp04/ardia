import AppKit
import ExpoModulesCore

public class WebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaWebView")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      WebViewModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)

    View(ChromiumTabView.self) {
      Events(PageEvents.channel)

      Prop("pageEvents") { (view: ChromiumTabView, names: [String]?) in view.pageEvents = Set(names ?? []) }

      Prop("url") { (view: ChromiumTabView, url: String?) in view.browser.initialURL = url }
      Prop("profile") { (view: ChromiumTabView, profile: String?) in view.browser.profile = profile ?? "" }
      Prop("adoptId") { (view: ChromiumTabView, id: String?) in view.browser.adoptId = id }
      Prop("tabId") { (view: ChromiumTabView, tabId: String?) in view.browser.transferKey = tabId }
      Prop("standalone") { (view: ChromiumTabView, standalone: Bool?) in view.browser.standalone = standalone ?? false }
      Prop("temporary") { (view: ChromiumTabView, temporary: Bool?) in view.browser.temporary = temporary ?? false }
      Prop("temporarySource") { (view: ChromiumTabView, source: String?) in view.browser.temporarySource = source }
      Prop("extensionHost") { (view: ChromiumTabView, kind: String?) in view.browser.extensionHost = kind }
      Prop("visible") { (view: ChromiumTabView, visible: Bool?) in view.browser.visible = visible ?? true }
      Prop("warm") { (view: ChromiumTabView, warm: Bool?) in view.browser.warm = warm ?? false }
      Prop("neighbour") { (view: ChromiumTabView, neighbour: Bool?) in view.browser.neighbour = neighbour ?? false }
      Prop("pageBackgroundColor") { (view: ChromiumTabView, color: NSColor?) in view.browser.pageBackgroundColor = color }
      Prop("pageColor") { (view: ChromiumTabView, color: String?) in view.browser.pageColor = color }
      Prop("contentsBackgroundColor") { (view: ChromiumTabView, color: NSColor?) in view.browser.contentsBackgroundColor = color }
      Prop("shownUrl") { (view: ChromiumTabView, url: String?) in view.browser.shownURL = url }
      Prop("autoPictureInPicture") { (view: ChromiumTabView, enabled: Bool?) in
        view.browser.autoPictureInPicture = enabled ?? false
      }

      AsyncFunction("loadUrl") { (view: ChromiumTabView, url: String, userInitiated: Bool?) in
        view.browser.loadURL(url, userInitiated: userInitiated ?? false)
      }.runOnQueue(.main)
      AsyncFunction("goBack") { (view: ChromiumTabView) in view.browser.goBack() }.runOnQueue(.main)
      AsyncFunction("goForward") { (view: ChromiumTabView) in view.browser.goForward() }.runOnQueue(.main)
      AsyncFunction("goToOffset") { (view: ChromiumTabView, offset: Int) in view.browser.go(toHistoryOffset: offset) }.runOnQueue(.main)
      AsyncFunction("reload") { (view: ChromiumTabView) in view.browser.reload() }.runOnQueue(.main)
      AsyncFunction("forceReload") { (view: ChromiumTabView) in view.browser.reloadIgnoringCache() }.runOnQueue(.main)
      AsyncFunction("stopLoading") { (view: ChromiumTabView) in view.browser.stopLoading() }.runOnQueue(.main)
      AsyncFunction("focus") { (view: ChromiumTabView) in view.browser.focusPage() }.runOnQueue(.main)
      AsyncFunction("setMuted") { (view: ChromiumTabView, muted: Bool) in view.browser.setMuted(muted) }.runOnQueue(.main)
      AsyncFunction("zoomStep") { (view: ChromiumTabView, direction: Int) in view.browser.zoomStep(direction) }.runOnQueue(.main)
      AsyncFunction("find") { (view: ChromiumTabView, text: String, forward: Bool, findNext: Bool) in
        view.browser.find(text, forward: forward, findNext: findNext)
      }.runOnQueue(.main)
      AsyncFunction("stopFinding") { (view: ChromiumTabView, clear: Bool) in view.browser.stopFinding(clear) }.runOnQueue(.main)
      AsyncFunction("print") { (view: ChromiumTabView) in view.browser.print() }.runOnQueue(.main)
      AsyncFunction("runPageCommand") { (view: ChromiumTabView, name: String) in view.browser.runPageCommand(name) }.runOnQueue(.main)
      AsyncFunction("showDevTools") { (view: ChromiumTabView, panel: String?) in view.browser.showDevTools(panel: panel) }
        .runOnQueue(.main)
      AsyncFunction("executeJavaScript") { (view: ChromiumTabView, code: String) in
        view.browser.executeJavaScript(code)
      }.runOnQueue(.main)
      AsyncFunction("evaluate") { (view: ChromiumTabView, code: String, promise: Promise) in
        view.browser.evaluate(code) { json in promise.resolve(json) }
      }.runOnQueue(.main)
      AsyncFunction("navigationEntries") { (view: ChromiumTabView, promise: Promise) in
        view.browser.navigationEntries { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("capturePicture") { (view: ChromiumTabView, scale: Double, promise: Promise) in
        view.browser.capturePicture(scale) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadFavicon") { (view: ChromiumTabView, url: String, promise: Promise) in
        view.browser.downloadFavicon(url, name: nil) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadImage") { (view: ChromiumTabView, url: String, maxPixels: Int, promise: Promise) in
        view.browser.downloadImage(url, maxPixels: maxPixels) { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("mediaCommand") { (view: ChromiumTabView, action: String, seconds: Double?) in
        view.browser.mediaCommand(action, seconds: seconds ?? 0)
      }.runOnQueue(.main)
      AsyncFunction("requestPictureInPicture") { (view: ChromiumTabView, clickAt: Double?, control: Int?, promise: Promise) in
        view.browser.requestPictureInPicture(clickAt: clickAt ?? 0, control: control ?? 0) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("takeControlPress") { (view: ChromiumTabView, clickAt: Double?, control: Int?) -> Bool in
        view.browser.takeControlPress(clickAt: clickAt ?? 0, control: control ?? 0)
      }.runOnQueue(.main)
      AsyncFunction("exitPictureInPicture") { (view: ChromiumTabView) in view.browser.exitPictureInPicture() }.runOnQueue(.main)

      AsyncFunction("getSecurityInfo") { (view: ChromiumTabView, promise: Promise) in
        view.browser.securityInfo { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("pageCookies") { (view: ChromiumTabView, urls: [String], promise: Promise) in
        view.browser.pageCookies(urls) { promise.resolve($0 ?? []) }
      }.runOnQueue(.main)
      AsyncFunction("openBlockedPopup") { (view: ChromiumTabView, id: String, always: Bool?) in
        view.browser.openBlockedPopup(id, always: always ?? false)
      }.runOnQueue(.main)
      AsyncFunction("clearSiteData") { (view: ChromiumTabView, promise: Promise) in
        view.browser.clearSiteData { result, error in
          if let error { return promise.reject("ERR_ENGINE", error) }
          promise.resolve(result)
        }
      }.runOnQueue(.main)

      AsyncFunction("resolvePasswordPrompt") { (view: ChromiumTabView, action: String, username: String?, password: String?) in
        view.browser.resolvePasswordPrompt(action, username: username, password: password)
      }.runOnQueue(.main)
      AsyncFunction("resolveAutofillPrompt") { (view: ChromiumTabView, promptId: Int, action: String) in
        view.browser.resolveAutofillPrompt(promptId, action: action)
      }.runOnQueue(.main)
      AsyncFunction("executeExtensionAction") { (view: ChromiumTabView, extensionId: String) in
        view.browser.executeExtensionAction(extensionId)
      }.runOnQueue(.main)

      AsyncFunction("resolveDisplayMedia") { (view: ChromiumTabView, id: String, sourceId: String?, audio: Bool) in
        view.browser.resolveDisplayMedia(id, sourceId: sourceId, audio: audio)
      }.runOnQueue(.main)
      AsyncFunction("mediaCaptureSourceId") { (view: ChromiumTabView) in view.browser.mediaCaptureSourceId }.runOnQueue(.main)
      AsyncFunction("notificationAction") { (view: ChromiumTabView, id: String, action: String) in
        view.browser.notificationAction(id, action: action)
      }.runOnQueue(.main)

      AsyncFunction("resolveUnresponsive") { (view: ChromiumTabView, terminate: Bool) in
        view.browser.resolveUnresponsive(terminate: terminate)
      }.runOnQueue(.main)
      AsyncFunction("discard") { (view: ChromiumTabView, unload: Bool?) in view.browser.discard(unload: unload ?? false) }
        .runOnQueue(.main)
      AsyncFunction("setFrozen") { (view: ChromiumTabView, frozen: Bool) in view.browser.frozen = frozen }.runOnQueue(.main)

      OnViewDidUpdateProps { (view: ChromiumTabView) in view.propsDidUpdate() }
    }
  }

  static func setting(_ apply: @escaping (CallArgs) -> Void) -> CallHandler {
    { args, reply in
      apply(args)
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "webView", handlers: [
    "setDisplayMediaPicker": setting { ArdiaWebView.setDisplayMediaPicker($0.bool("enabled") ?? false) },
    "setPeekModifier": setting { ArdiaWebView.setPeekModifier($0.text("modifier")) },
    "setSplitLinkModifier": setting { ArdiaWebView.setSplitLinkModifier($0.text("modifier")) },
    "setSelectionPopover": setting { ArdiaWebView.setSelectionPopoverEnabled($0.bool("enabled") ?? false) },
    "setAutoPictureInPicture": setting { ArdiaWebView.setAutoPictureInPictureEnabled($0.bool("enabled") ?? false) },
    "setVideoUpscaling": setting { ArdiaWebView.setVideoUpscalingEnabled($0.bool("enabled") ?? false) },
    "setVideoUpscalingTestConditions": setting { args in
      var conditions: [String: NSNumber] = [:]
      for key in ["lowPower", "thermalPressure"] { if let on = args.bool(key) { conditions[key] = NSNumber(value: on) } }
      ArdiaWebView.setVideoUpscalingTestConditions(conditions)
    },
    "videoUpscalingState": { _, reply in reply.ok(ArdiaWebView.videoUpscalingState()) },
  ])
}


import AppKit
import ExpoModulesCore

enum PageViewDefinition {
  static func of<V: PageTabHost>(_ viewType: V.Type) -> ViewDefinition<V> {
    View(viewType) {
      Events(PageEvents.channel)

      Prop("pageEvents") { (view: V, names: [String]?) in view.pageEvents = Set(names ?? []) }

      Prop("url") { (view: V, url: String?) in view.page.initialURL = url }
      Prop("profile") { (view: V, profile: String?) in view.page.profile = profile ?? "" }
      Prop("adoptId") { (view: V, id: String?) in view.page.adoptId = id }
      Prop("tabId") { (view: V, tabId: String?) in view.page.transferKey = tabId }
      Prop("standalone") { (view: V, standalone: Bool?) in view.page.standalone = standalone ?? false }
      Prop("temporary") { (view: V, temporary: Bool?) in view.page.temporary = temporary ?? false }
      Prop("temporarySource") { (view: V, source: String?) in view.page.temporarySource = source }
      Prop("extensionHost") { (view: V, kind: String?) in view.page.extensionHost = kind }
      Prop("visible") { (view: V, visible: Bool?) in view.page.visible = visible ?? true }
      Prop("warm") { (view: V, warm: Bool?) in view.page.warm = warm ?? false }
      Prop("neighbour") { (view: V, neighbour: Bool?) in view.page.neighbour = neighbour ?? false }
      Prop("pageBackgroundColor") { (view: V, color: NSColor?) in view.page.pageBackgroundColor = color }
      Prop("pageColor") { (view: V, color: String?) in view.page.pageColor = color }
      Prop("contentsBackgroundColor") { (view: V, color: NSColor?) in view.page.contentsBackgroundColor = color }
      Prop("shownUrl") { (view: V, url: String?) in view.page.shownURL = url }
      Prop("autoPictureInPicture") { (view: V, enabled: Bool?) in view.page.autoPictureInPicture = enabled ?? false }

      AsyncFunction("loadUrl") { (view: V, url: String, userInitiated: Bool?) in
        view.page.loadURL(url, userInitiated: userInitiated ?? false)
      }.runOnQueue(.main)
      AsyncFunction("goBack") { (view: V) in view.page.goBack() }.runOnQueue(.main)
      AsyncFunction("goForward") { (view: V) in view.page.goForward() }.runOnQueue(.main)
      AsyncFunction("goToOffset") { (view: V, offset: Int) in view.page.go(toHistoryOffset: offset) }.runOnQueue(.main)
      AsyncFunction("reload") { (view: V) in view.page.reload() }.runOnQueue(.main)
      AsyncFunction("forceReload") { (view: V) in view.page.reloadIgnoringCache() }.runOnQueue(.main)
      AsyncFunction("stopLoading") { (view: V) in view.page.stopLoading() }.runOnQueue(.main)
      AsyncFunction("focus") { (view: V) in view.page.focusPage() }.runOnQueue(.main)
      AsyncFunction("setMuted") { (view: V, muted: Bool) in view.page.setMuted(muted) }.runOnQueue(.main)
      AsyncFunction("zoomStep") { (view: V, direction: Int) in view.page.zoomStep(direction) }.runOnQueue(.main)
      AsyncFunction("find") { (view: V, text: String, forward: Bool, findNext: Bool) in
        view.page.find(text, forward: forward, findNext: findNext)
      }.runOnQueue(.main)
      AsyncFunction("stopFinding") { (view: V, clear: Bool) in view.page.stopFinding(clear) }.runOnQueue(.main)
      AsyncFunction("print") { (view: V) in view.page.print() }.runOnQueue(.main)
      AsyncFunction("runPageCommand") { (view: V, name: String) in view.page.runPageCommand(name) }.runOnQueue(.main)
      AsyncFunction("showDevTools") { (view: V, panel: String?) in view.page.showDevTools(panel: panel) }.runOnQueue(.main)
      AsyncFunction("executeJavaScript") { (view: V, code: String) in view.page.executeJavaScript(code) }.runOnQueue(.main)
      AsyncFunction("evaluate") { (view: V, code: String, promise: Promise) in
        view.page.evaluate(code) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("navigationEntries") { (view: V, promise: Promise) in
        view.page.navigationEntries { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("capturePicture") { (view: V, scale: Double, promise: Promise) in
        view.page.capturePicture(scale) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadFavicon") { (view: V, url: String, promise: Promise) in
        view.page.downloadFavicon(url) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadImage") { (view: V, url: String, maxPixels: Int, promise: Promise) in
        view.page.downloadImage(url, maxPixels: maxPixels) { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("mediaCommand") { (view: V, action: String, seconds: Double?) in
        view.page.mediaCommand(action, seconds: seconds ?? 0)
      }.runOnQueue(.main)
      AsyncFunction("requestPictureInPicture") { (view: V, clickAt: Double?, control: Int?, promise: Promise) in
        view.page.requestPictureInPicture(clickAt: clickAt ?? 0, control: control ?? 0) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("takeControlPress") { (view: V, clickAt: Double?, control: Int?) -> Bool in
        view.page.takeControlPress(clickAt: clickAt ?? 0, control: control ?? 0)
      }.runOnQueue(.main)
      AsyncFunction("exitPictureInPicture") { (view: V) in view.page.exitPictureInPicture() }.runOnQueue(.main)

      AsyncFunction("getSecurityInfo") { (view: V, promise: Promise) in
        view.page.securityInfo { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("pageCookies") { (view: V, urls: [String], promise: Promise) in
        view.page.pageCookies(urls) { promise.resolve($0 ?? []) }
      }.runOnQueue(.main)
      AsyncFunction("openBlockedPopup") { (view: V, id: String, always: Bool?) in
        view.page.openBlockedPopup(id, always: always ?? false)
      }.runOnQueue(.main)
      AsyncFunction("clearSiteData") { (view: V, promise: Promise) in
        view.page.clearSiteData { result, error in
          if let error { return promise.reject("ERR_ENGINE", error) }
          promise.resolve(result)
        }
      }.runOnQueue(.main)

      AsyncFunction("resolvePasswordPrompt") { (view: V, action: String, username: String?, password: String?) in
        view.page.resolvePasswordPrompt(action, username: username, password: password)
      }.runOnQueue(.main)
      AsyncFunction("resolveAutofillPrompt") { (view: V, promptId: Int, action: String) in
        view.page.resolveAutofillPrompt(promptId, action: action)
      }.runOnQueue(.main)
      AsyncFunction("executeExtensionAction") { (view: V, extensionId: String) -> String? in
        view.page.executeExtensionAction(extensionId)
      }.runOnQueue(.main)

      AsyncFunction("resolveDisplayMedia") { (view: V, id: String, sourceId: String?, audio: Bool) in
        view.page.resolveDisplayMedia(id, sourceId: sourceId, audio: audio)
      }.runOnQueue(.main)
      AsyncFunction("mediaCaptureSourceId") { (view: V) -> String? in view.page.mediaCaptureSourceId }.runOnQueue(.main)
      AsyncFunction("notificationAction") { (view: V, id: String, action: String) in
        view.page.notificationAction(id, action: action)
      }.runOnQueue(.main)

      AsyncFunction("resolveUnresponsive") { (view: V, terminate: Bool) in view.page.resolveUnresponsive(terminate: terminate) }
        .runOnQueue(.main)
      AsyncFunction("discard") { (view: V, unload: Bool?) -> String in view.page.discard(unload: unload ?? false) }.runOnQueue(.main)
      AsyncFunction("setFrozen") { (view: V, frozen: Bool) in view.page.frozen = frozen }.runOnQueue(.main)

      OnViewDidUpdateProps { (view: V) in view.propsDidUpdate() }
    }
  }
}

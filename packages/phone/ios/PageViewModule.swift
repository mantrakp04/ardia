import ArdiaBrowser
import ExpoModulesCore
import UIKit
import WebKit

struct PageSetupRecord: Record {
  @Field var url: String? = nil
  @Field var title: String? = nil
  @Field var isPrivate: Bool = false
  @Field var savedState: String? = nil
}

struct RequestAnswerRecord: Record {
  @Field var type: String = ""
  @Field var text: String? = nil
  @Field var user: String? = nil
  @Field var password: String? = nil
}

public final class PageViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPageView")

    Events("onPageEngineEvent")

    OnCreate {
      MainActor.assumeIsolated {
        PhonePages.shared.pageSink = { [weak self] event in self?.sendEvent("onPageEngineEvent", event) }
      }
    }

    OnDestroy {
      MainActor.assumeIsolated { PhonePages.shared.pageSink = nil }
    }

    Function("capabilities") { () -> [String: Any] in
      [
        "engineName": "WebKit",
        "isDevelopmentOnly": false,
        "supportsPrivatePages": true,
        "pageZoomLevels": WebTab.zoomLevels,
        "pageZoomScalesTextOnly": false,
        "snapshotsIncludeVideo": false,
      ]
    }

    Function("launchOptions") { () -> [String: Any] in
      ["pageLab": UserDefaults.standard.bool(forKey: "ArdiaPageLab")]
    }

    AsyncFunction("openPage") { (pageID: String, setup: PageSetupRecord) in
      try MainActor.assumeIsolated {
        _ = try PhonePages.shared.open(pageID, url: setup.url, title: setup.title, isPrivate: setup.isPrivate, savedState: setup.savedState)
      }
    }.runOnQueue(.main)

    AsyncFunction("closePage") { (pageID: String) in
      MainActor.assumeIsolated { PhonePages.shared.close(pageID) }
    }.runOnQueue(.main)

    AsyncFunction("pageIds") { () -> [String] in
      MainActor.assumeIsolated { PhonePages.shared.pageIDList }
    }.runOnQueue(.main)

    AsyncFunction("pageState") { (pageID: String) -> [String: Any]? in
      MainActor.assumeIsolated { PhonePages.shared.page(pageID).map(PhonePages.shared.state) }
    }.runOnQueue(.main)

    AsyncFunction("load") { (pageID: String, url: String) in
      try MainActor.assumeIsolated {
        guard let target = URL(string: url) else { throw PagePayloads.badArgs("Not a URL: \(url)") }
        try PhonePages.shared.require(pageID).load(target)
      }
    }.runOnQueue(.main)

    AsyncFunction("reload") { (pageID: String) in
      try MainActor.assumeIsolated { try PhonePages.shared.require(pageID).reload() }
    }.runOnQueue(.main)

    AsyncFunction("stopLoading") { (pageID: String) in
      try MainActor.assumeIsolated { try PhonePages.shared.require(pageID).stopLoading() }
    }.runOnQueue(.main)

    AsyncFunction("goBack") { (pageID: String) -> Bool in
      try MainActor.assumeIsolated {
        let page = try PhonePages.shared.require(pageID)
        guard page.canGoBack else { return false }
        page.goBack()
        return true
      }
    }.runOnQueue(.main)

    AsyncFunction("goForward") { (pageID: String) -> Bool in
      try MainActor.assumeIsolated {
        let page = try PhonePages.shared.require(pageID)
        guard page.canGoForward else { return false }
        page.goForward()
        return true
      }
    }.runOnQueue(.main)

    AsyncFunction("find") { (pageID: String, text: String, promise: Promise) in
      Self.main(promise) { try await PhonePages.shared.find(pageID).start(text) }
    }.runOnQueue(.main)

    AsyncFunction("findNext") { (pageID: String, promise: Promise) in
      Self.main(promise) { try await PhonePages.shared.find(pageID).step(backwards: false) }
    }.runOnQueue(.main)

    AsyncFunction("findPrevious") { (pageID: String, promise: Promise) in
      Self.main(promise) { try await PhonePages.shared.find(pageID).step(backwards: true) }
    }.runOnQueue(.main)

    AsyncFunction("endFind") { (pageID: String, promise: Promise) in
      Self.main(promise) { await PhonePages.shared.endFind(pageID) }
    }.runOnQueue(.main)

    AsyncFunction("setPageZoom") { (pageID: String, zoom: Double) -> Double in
      try MainActor.assumeIsolated {
        let page = try PhonePages.shared.require(pageID)
        page.setPageZoom(zoom)
        return page.pageZoom
      }
    }.runOnQueue(.main)

    AsyncFunction("zoomIn") { (pageID: String) -> Double in
      try MainActor.assumeIsolated {
        let page = try PhonePages.shared.require(pageID)
        page.zoomIn()
        return page.pageZoom
      }
    }.runOnQueue(.main)

    AsyncFunction("zoomOut") { (pageID: String) -> Double in
      try MainActor.assumeIsolated {
        let page = try PhonePages.shared.require(pageID)
        page.zoomOut()
        return page.pageZoom
      }
    }.runOnQueue(.main)

    AsyncFunction("setDesktopSite") { (pageID: String, enabled: Bool) in
      try MainActor.assumeIsolated { try PhonePages.shared.setDesktopSite(pageID, enabled) }
    }.runOnQueue(.main)

    AsyncFunction("download") { (pageID: String, url: String) in
      try MainActor.assumeIsolated {
        let page = try PhonePages.shared.require(pageID)
        guard let target = URL(string: url) else { throw PagePayloads.badArgs("Not a URL: \(url)") }
        guard page.isLive else { throw PagePayloads.error("ERR_PAGE_NOT_LIVE", "The page \(pageID) has no web view to download with") }
        PhonePages.shared.engine.download(target, from: page.id)
      }
    }.runOnQueue(.main)

    AsyncFunction("readableContent") { (pageID: String, promise: Promise) in
      Self.main(promise) { () -> [String: Any?]? in
        let page = try PhonePages.shared.require(pageID)
        guard let content = try? await page.readableContent() else { return nil }
        return PagePayloads.readable(content)
      }
    }.runOnQueue(.main)

    AsyncFunction("snapshot") { (pageID: String, maxWidth: Int?, quality: Int?, promise: Promise) in
      Self.main(promise) { try await PhonePages.shared.snapshot(pageID, maxWidth: maxWidth, quality: quality) }
    }.runOnQueue(.main)

    AsyncFunction("deleteSnapshots") { (pageID: String) in
      PageSnapshots.delete(pageID)
    }

    AsyncFunction("saveState") { (pageID: String) -> String? in
      MainActor.assumeIsolated { PhonePages.shared.saveState(pageID) }
    }.runOnQueue(.main)

    AsyncFunction("answerRequest") { (pageID: String, requestID: String, answer: RequestAnswerRecord) -> Bool in
      try MainActor.assumeIsolated {
        let parsed = try PagePayloads.answer(type: answer.type, text: answer.text, user: answer.user, password: answer.password)
        return PhonePages.shared.answer(pageID, requestID: requestID, answer: parsed)
      }
    }.runOnQueue(.main)

    AsyncFunction("openPopup") { (pageID: String, popupID: String) -> Bool in
      try MainActor.assumeIsolated { try PhonePages.shared.openPopup(pageID, popupID: popupID) }
    }.runOnQueue(.main)

    AsyncFunction("dismissPopup") { (popupID: String) -> Bool in
      MainActor.assumeIsolated { PhonePages.shared.dismissPopup(popupID) }
    }.runOnQueue(.main)

    AsyncFunction("exitFullscreen") { (pageID: String) in
      MainActor.assumeIsolated { PhonePages.shared.page(pageID)?.webView?.closeAllMediaPresentations() }
    }.runOnQueue(.main)

    AsyncFunction("endPrivateSession") {
      MainActor.assumeIsolated { PhonePages.shared.endPrivateSession() }
    }.runOnQueue(.main)

    AsyncFunction("nightShade") { (host: String?, isPrivate: Bool?) -> [String: Any?] in
      MainActor.assumeIsolated {
        let preferences = PhonePages.shared.engine.preferences
        let site = host.flatMap { preferences.settings(for: $0, isPrivate: isPrivate == true).nightShade }
        return [
          "defaultMode": PagePayloads.nightShade(preferences.nightShade),
          "siteMode": site.map(PagePayloads.nightShade),
          "mode": PagePayloads.nightShade(preferences.nightShade(for: host, isPrivate: isPrivate == true)),
        ]
      }
    }.runOnQueue(.main)

    AsyncFunction("setNightShade") { (mode: String?, host: String?, isPrivate: Bool?) in
      try MainActor.assumeIsolated {
        let parsed = try mode.map(PagePayloads.nightShadeMode)
        let preferences = PhonePages.shared.engine.preferences
        if let host {
          preferences.update(host, isPrivate: isPrivate == true) { $0.nightShade = parsed }
        } else {
          preferences.nightShade = parsed ?? .disabled
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("opensLinksInApps") { (host: String) -> Bool in
      MainActor.assumeIsolated { PhonePages.shared.engine.preferences.appLinks(for: host) == .app }
    }.runOnQueue(.main)

    AsyncFunction("setOpensLinksInApps") { (host: String, opens: Bool) in
      MainActor.assumeIsolated { PhonePages.shared.engine.preferences.update(host) { $0.appLinks = opens ? .app : .ardia } }
    }.runOnQueue(.main)

    AsyncFunction("clearWebsiteData") { (kinds: [String], promise: Promise) in
      Self.main(promise) {
        let parsed = try Set(kinds.map { kind -> BrowsingDataKind in
          switch kind {
          case "cache": return .cache
          case "cookiesAndSiteData": return .cookiesAndSiteData
          default: throw PagePayloads.badArgs("Unknown website data kind \(kind)")
          }
        })
        await BrowsingDataCleaner.clear(parsed, tabs: PhonePages.shared.engine.tabs)
      }
    }.runOnQueue(.main)

    AsyncFunction("setInspectable") { (inspectable: Bool) in
      MainActor.assumeIsolated {
        let pages = PhonePages.shared
        pages.engine.isInspectable = inspectable
        for id in pages.pageIDList { pages.page(id)?.webView?.isInspectable = inspectable }
      }
    }.runOnQueue(.main)

    View(PageView.self) {
      Events("onPageEvent")

      Prop("pageId") { (view: PageView, pageID: String) in
        view.pageID = pageID
      }

      Prop("initialUrl") { (view: PageView, url: String?) in
        view.initialURL = url
      }

      Prop("title") { (view: PageView, title: String?) in
        view.title = title
      }

      Prop("isPrivate") { (view: PageView, isPrivate: Bool?) in
        view.isPrivate = isPrivate == true
      }

      Prop("savedState") { (view: PageView, savedState: String?) in
        view.savedState = savedState
      }

      Prop("toneInsets") { (view: PageView, insets: [Double]?) in
        if let insets, insets.count == 2 {
          view.toneInsets = (CGFloat(insets[0]), CGFloat(insets[1]))
        } else {
          view.toneInsets = (0, 0)
        }
      }

      OnViewDidUpdateProps { (view: PageView) in
        MainActor.assumeIsolated { view.bind() }
      }

      AsyncFunction("loadUrl") { (view: PageView, url: String) in
        MainActor.assumeIsolated { view.load(url) }
      }.runOnQueue(.main)

      AsyncFunction("goBack") { (view: PageView) -> Bool in
        MainActor.assumeIsolated { view.goBack() }
      }.runOnQueue(.main)

      AsyncFunction("goForward") { (view: PageView) -> Bool in
        MainActor.assumeIsolated { view.goForward() }
      }.runOnQueue(.main)

      AsyncFunction("reload") { (view: PageView) in
        MainActor.assumeIsolated { view.page?.reload() }
      }.runOnQueue(.main)

      AsyncFunction("stopLoading") { (view: PageView) in
        MainActor.assumeIsolated { view.page?.stopLoading() }
      }.runOnQueue(.main)
    }
  }

  static func main<Value>(_ promise: Promise, _ work: @escaping @MainActor () async throws -> Value) {
    Task { @MainActor in
      do {
        let value = try await work()
        promise.resolve(Value.self == Void.self ? nil : value)
      } catch let exception as Exception {
        promise.reject(exception)
      } catch {
        promise.reject("ERR_PAGE", error.localizedDescription)
      }
    }
  }
}

public final class BlockingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaBlocking")

    Events("onBlockingEvent")

    OnCreate {
      MainActor.assumeIsolated {
        PhonePages.shared.blockingSink = { [weak self] event in self?.sendEvent("onBlockingEvent", event) }
      }
    }

    OnDestroy {
      MainActor.assumeIsolated { PhonePages.shared.blockingSink = nil }
    }

    AsyncFunction("state") { () -> [String: Any?] in
      MainActor.assumeIsolated { PhonePages.shared.blockingState() }
    }.runOnQueue(.main)

    AsyncFunction("setEnabled") { (enabled: Bool) in
      MainActor.assumeIsolated { PhonePages.shared.engine.blocker.settings.isOn = enabled }
    }.runOnQueue(.main)

    AsyncFunction("setCategory") { (category: String, enabled: Bool) in
      try MainActor.assumeIsolated {
        let settings = PhonePages.shared.engine.blocker.settings
        switch BlockingCategory(rawValue: category) {
        case .ads: settings.blocksAds = enabled
        case .trackers: settings.blocksTrackers = enabled
        case .cookieBanners: settings.hidesCookieBanners = enabled
        case nil: throw PagePayloads.badArgs("Unknown blocking category \(category)")
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("isEnabledForSite") { (url: String, isPrivate: Bool?) -> Bool in
      MainActor.assumeIsolated {
        let settings = PhonePages.shared.engine.blocker.settings
        return settings.isOn && !settings.isExempt(BrowserURL.host(of: url), isPrivate: isPrivate == true)
      }
    }.runOnQueue(.main)

    AsyncFunction("setEnabledForSite") { (url: String, enabled: Bool, isPrivate: Bool?) -> String? in
      MainActor.assumeIsolated {
        guard let host = BrowserURL.host(of: url) else { return nil }
        PhonePages.shared.engine.blocker.settings.setExempt(host, !enabled, isPrivate: isPrivate == true)
        return host
      }
    }.runOnQueue(.main)

    AsyncFunction("setListEnabled") { (id: String, enabled: Bool) in
      MainActor.assumeIsolated { PhonePages.shared.engine.blocker.filterLists.setEnabled(id, enabled) }
    }.runOnQueue(.main)

    AsyncFunction("removeList") { (id: String) in
      MainActor.assumeIsolated { PhonePages.shared.engine.blocker.filterLists.removeList(id) }
    }.runOnQueue(.main)

    AsyncFunction("updateLists") { (promise: Promise) in
      PageViewModule.main(promise) { await PhonePages.shared.engine.blocker.refreshIfDue(force: true) }
    }.runOnQueue(.main)

    AsyncFunction("resetToDefaults") { (promise: Promise) in
      PageViewModule.main(promise) { await PhonePages.shared.engine.blocker.filterLists.resetToDefaults() }
    }.runOnQueue(.main)

    AsyncFunction("addCustomList") { (url: String, promise: Promise) in
      PageViewModule.main(promise) { () -> String in
        guard let target = URL(string: url) else { throw PagePayloads.badArgs("Not a URL: \(url)") }
        do {
          return try await PhonePages.shared.engine.blocker.filterLists.addCustomList(url: target).id
        } catch {
          throw PagePayloads.error("ERR_FILTER_LIST", (error as? FilterListError)?.message ?? error.localizedDescription)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("setMyFilters") { (text: String, promise: Promise) in
      PageViewModule.main(promise) { () -> [String: Any] in
        let result = await PhonePages.shared.engine.blocker.filterLists.applyMyFilters(text)
        return ["ruleCount": result.ruleCount, "skippedCount": result.skippedCount, "isTooLarge": false]
      }
    }.runOnQueue(.main)

    AsyncFunction("blockedCount") { (pageID: String) -> Int? in
      MainActor.assumeIsolated { PhonePages.shared.page(pageID)?.blockedResources.count }
    }.runOnQueue(.main)
  }
}

public final class DownloadsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaDownloads")

    Events("onDownloadEvent")

    OnCreate {
      MainActor.assumeIsolated {
        PhonePages.shared.downloadSink = { [weak self] event in self?.sendEvent("onDownloadEvent", event) }
      }
    }

    OnDestroy {
      MainActor.assumeIsolated { PhonePages.shared.downloadSink = nil }
    }

    AsyncFunction("active") { () -> [[String: Any?]] in
      MainActor.assumeIsolated { PhonePages.shared.engine.downloads.progress.map(PagePayloads.download) }
    }.runOnQueue(.main)

    AsyncFunction("cancel") { (id: String) in
      MainActor.assumeIsolated {
        guard let uuid = UUID(uuidString: id) else { return }
        PhonePages.shared.engine.downloads.cancel(uuid)
      }
    }.runOnQueue(.main)

    AsyncFunction("open") { (uri: String) -> Bool in
      MainActor.assumeIsolated {
        guard let url = URL(string: uri), url.isFileURL, FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return false }
        PhonePages.present(UIActivityViewController(activityItems: [url], applicationActivities: nil))
        return true
      }
    }.runOnQueue(.main)
  }
}

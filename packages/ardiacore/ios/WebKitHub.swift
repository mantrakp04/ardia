import AppKit
import AuthenticationServices
import WebKit

final class WebKitHub: NSObject, WKScriptMessageHandler {
  static let shared = WebKitHub()
  static let world = WKContentWorld.world(name: "ardia")
  static let silenced = LaunchConfig.shared.background && !LaunchConfig.shared.instanceFlag("allowAudio")

  let downloads = WebKitDownloads()
  let stores = WebKitStores()
  let transfers = WebKitTransfers()
  private(set) lazy var permissions = WebKitPermissions(stores: stores, transfers: transfers)
  private(set) lazy var externalApps = WebKitExternalApps(stores: stores)
  private var lastBrowserId: Int32 = -1000

  func nextBrowserId() -> Int32 {
    lastBrowserId -= 1
    return lastBrowserId
  }

  static let safariVersion: String = {
    let paths = ["/Applications/Safari.app", "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app"]
    for path in paths {
      if let version = Bundle(path: path)?.infoDictionary?["CFBundleShortVersionString"] as? String {
        return version.split(separator: ".").prefix(2).joined(separator: ".")
      }
    }
    return "18.6"
  }()

  static let inspectable: Bool = {
    if LaunchConfig.shared.dataDirectory != nil { return true }
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return true }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(code as! SecStaticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
      let info = info as? [String: Any]
    else { return true }
    return info[kSecCodeInfoTeamIdentifier as String] == nil
  }()

  static let passkeysEntitled: Bool = {
    guard let task = SecTaskCreateFromSelf(nil) else { return false }
    let value = SecTaskCopyValueForEntitlement(task, "com.apple.developer.web-browser.public-key-credential" as CFString, nil)
    return (value as? Bool) == true
  }()

  static let hidePasskeys = """
    (() => {
      try { delete window.PublicKeyCredential; } catch (e) {}
      const container = window.CredentialsContainer && CredentialsContainer.prototype;
      if (!container) return;
      for (const name of ["create", "get"]) {
        const original = container[name];
        if (typeof original !== "function") continue;
        Object.defineProperty(container, name, {
          configurable: true, writable: true,
          value: {
            [name](options) {
              if (options && typeof options === "object" && "publicKey" in options) {
                return Promise.reject(new DOMException("Passkeys aren't available in this browser.", "NotSupportedError"));
              }
              return original.apply(this, arguments);
            },
          }[name],
        });
      }
    })();
    """

  func configuration(profile: String) -> WKWebViewConfiguration {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = stores.dataStore(for: profile)
    let controller = WKUserContentController()
    controller.addUserScript(WKUserScript(source: WebKitPageScript.source, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: Self.world))
    controller.add(self, contentWorld: Self.world, name: "ardia")
    controller.addUserScript(WKUserScript(source: WebKitPageScript.mediaBridge, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page))
    if !Self.passkeysEntitled {
      controller.addUserScript(WKUserScript(source: Self.hidePasskeys, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page))
    }
    config.userContentController = controller
    config.applicationNameForUserAgent = "Version/\(Self.safariVersion) Safari/605.1.15"
    config.mediaTypesRequiringUserActionForPlayback = []
    config.allowsAirPlayForMediaPlayback = true
    config.preferences.isElementFullscreenEnabled = !LaunchConfig.shared.background
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.preferences.isFraudulentWebsiteWarningEnabled = false
    config.defaultWebpagePreferences.preferredContentMode = .desktop
    return config
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let webView = message.webView, let tab = transfers.owner(of: webView), let body = message.body as? [String: Any],
      let kind = body["kind"] as? String
    else { return }
    tab.pageMessage(kind, data: body["data"], frame: body["frame"] as? String ?? "", frameInfo: message.frameInfo)
  }

  static func close(_ webView: WKWebView) {
    WebKitHub.shared.transfers.unregister(webView)
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.stopLoading()
    webView.pauseAllMediaPlayback(completionHandler: {})
    webView.closeAllMediaPresentations(completionHandler: {})
    webView.removeFromSuperview()
  }

  func resumeHost(for profile: String) -> WKWebView {
    stores.resumeHost(for: profile) { configuration(profile: profile) }
  }

  private func closeViews(using store: WKWebsiteDataStore, id: WebKitStores.StoreID) {
    transfers.closeViews(using: store)
    stores.takeResumeHosts(using: store).forEach(Self.close)
    permissions.drop(store: id)
  }

  func endPrivateSession(_ name: String) {
    guard let ended = stores.endPrivateSession(name) else { return }
    closeViews(using: ended.store, id: ended.id)
    ended.store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
  }

  static let siteDataTypes: Set<String> = WKWebsiteDataStore.allWebsiteDataTypes().subtracting([
    WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache,
  ])

  func clearBrowsingData(profile: String, types: [String], since: Double, completion: @escaping () -> Void) {
    var kinds = Set<String>()
    if types.contains("siteData") { kinds.formUnion(Self.siteDataTypes) }
    if types.contains("cache") { kinds.formUnion([WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache]) }
    if types.contains("siteData") { stores.forgetSitePermissions(of: profile) }
    guard !kinds.isEmpty else { return completion() }
    stores.dataStore(for: profile).removeData(ofTypes: kinds, modifiedSince: Date(timeIntervalSince1970: since / 1000), completionHandler: completion)
  }

  static func covers(_ domain: String, host: String) -> Bool {
    let name = domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
    return !name.isEmpty && (host == name || host.hasSuffix("." + name))
  }

  func clearSiteData(profile: String, host rawHost: String, completion: @escaping ([String: Any]) -> Void) {
    let store = stores.dataStore(for: profile)
    let host = rawHost.lowercased()
    store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
      let matching = records.filter { Self.covers($0.displayName, host: host) }
      store.httpCookieStore.getAllCookies { cookies in
        let count = cookies.filter { Self.covers($0.domain, host: host) }.count
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: matching) {
          completion(["cookies": count, "storage": true])
        }
      }
    }
  }

  func deleteProfileData(_ profile: String, completion: @escaping (Bool) -> Void) {
    guard !WebKitStores.isPrivate(profile) else { return completion(true) }
    let identifier = WebKitStores.storeIdentifier(profile)
    let removed = stores.forgetProfile(profile)
    downloads.cancelAll(profile: profile)
    if let host = stores.takeResumeHost(of: profile) { Self.close(host) }
    let removeStore = {
      WebKitStoreRemovals.exists(identifier) { exists in
        guard exists else { return completion(true) }
        WebKitStoreRemovals.remove(identifier, tries: 12, done: completion)
      }
    }
    guard let store = removed else { return removeStore() }
    closeViews(using: store, id: .profile(profile))
    store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { DispatchQueue.main.async(execute: removeStore) }
  }

  func storeExists(_ profile: String, done: @escaping (Bool) -> Void) {
    WebKitStoreRemovals.exists(WebKitStores.storeIdentifier(profile), done: done)
  }

  func touchStore(_ profile: String, done: @escaping (Bool) -> Void) {
    let cookies = stores.dataStore(for: profile).httpCookieStore
    let cookie = HTTPCookie(properties: [.name: "ardia-touch", .value: "1", .domain: "ardia.test", .path: "/", .expires: Date().addingTimeInterval(86400)])
    cookies.getAllCookies { existing in
      let touched = existing.contains { $0.name == "ardia-touch" && $0.domain.hasSuffix("ardia.test") }
      guard let cookie else { return done(touched) }
      cookies.setCookie(cookie) { done(touched) }
    }
  }
}

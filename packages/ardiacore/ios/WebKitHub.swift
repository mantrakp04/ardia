import AppKit
import AuthenticationServices
import CryptoKit
import WebKit

final class WebKitHub: NSObject, WKScriptMessageHandler {
  static let shared = WebKitHub()
  static let world = WKContentWorld.world(name: "ardia")
  static let background = LaunchConfig.shared.background
  static let silenced = background && !LaunchConfig.shared.instanceFlag("allowAudio")

  let downloads = WebKitDownloads()

  private final class WeakTab {
    weak var tab: WebKitTab?
    init(_ tab: WebKitTab) { self.tab = tab }
  }

  private struct PrivateSession {
    let store: WKWebsiteDataStore
    let token: String
  }

  private struct PendingPermission {
    let browserId: Int32
    let keys: [String]
    let store: WKWebsiteDataStore
    let decide: (Bool) -> Void
  }

  private struct PendingExternal {
    let url: URL
    let allowance: String?
    let grant: ExternalGrant?
  }

  private struct ExternalGrant {
    let origin: String
    let scheme: String
    let app: String
    let appPath: String
  }

  private var lastBrowserId: Int32 = -1000
  private var persistentStores: [String: WKWebsiteDataStore] = [:]
  private var privateSessions: [String: PrivateSession] = [:]
  private var owners: [ObjectIdentifier: WeakTab] = [:]
  private var liveByKey: [String: WeakTab] = [:]
  private let transferLock = NSLock()
  private var prepared = Set<String>()
  private var parked: [String: WKWebView] = [:]
  private var offered: [String: WKWebView] = [:]
  private var lastOffer = 0
  private var pendingPermissions: [String: PendingPermission] = [:]
  private var rememberedPermissions: [String: Bool] = [:]
  private var lastPermission = 0
  private var zoomByHost: [String: Double] = [:]
  private var pendingExternal: [String: PendingExternal] = [:]
  private var externalAllowances: [String: ExternalGrant] = [:]
  private var lastExternal = 0
  private var resumeHosts: [String: WKWebView] = [:]
  private var deletedProfileStores: [String: WKWebsiteDataStore] = [:]
  private var storesHeldForTest: [String: WKWebsiteDataStore] = [:]

  func nextBrowserId() -> Int32 {
    lastBrowserId -= 1
    return lastBrowserId
  }

  static func isPrivate(_ profile: String) -> Bool { ArdiaHost.isPrivateProfile(profile) }

  static func privateSession(_ profile: String) -> String { ArdiaHost.baseProfile(of: profile) }

  static func regularProfile(_ profile: String) -> String { ArdiaHost.baseProfile(of: profile) }

  private func session(_ name: String) -> PrivateSession {
    if let live = privateSessions[name] { return live }
    let made = PrivateSession(store: .nonPersistent(), token: UUID().uuidString)
    privateSessions[name] = made
    return made
  }

  func storeKey(_ profile: String) -> String {
    guard Self.isPrivate(profile) else { return profile }
    let name = Self.privateSession(profile)
    return "private@\(name)#\(session(name).token)"
  }

  static func storeIdentifier(_ profile: String) -> UUID {
    let scope = LaunchConfig.shared.dataDirectory ?? ""
    var bytes = Array(SHA256.hash(data: Data("ardia.webkit|\(scope)|\(profile)".utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x50
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return bytes.withUnsafeBufferPointer { NSUUID(uuidBytes: $0.baseAddress!) as UUID }
  }

  func dataStore(for profile: String) -> WKWebsiteDataStore {
    if Self.isPrivate(profile) { return session(Self.privateSession(profile)).store }
    if let store = persistentStores[profile] ?? deletedProfileStores[profile] { return store }
    let store = WKWebsiteDataStore(forIdentifier: Self.storeIdentifier(profile))
    persistentStores[profile] = store
    return store
  }

  func liveDataStore(for profile: String, storeKey key: String) -> WKWebsiteDataStore? {
    guard Self.isPrivate(profile) else { return key == profile ? dataStore(for: profile) : nil }
    let name = Self.privateSession(profile)
    guard let live = privateSessions[name], key == "private@\(name)#\(live.token)" else { return nil }
    return live.store
  }

  func endPrivateSession(_ name: String) {
    guard let ended = privateSessions.removeValue(forKey: name) else { return }
    let prefix = "private@\(name)#\(ended.token)|"
    rememberedPermissions = rememberedPermissions.filter { !$0.key.hasPrefix(prefix) }
    zoomByHost = zoomByHost.filter { !$0.key.hasPrefix(prefix) }
    externalAllowances = externalAllowances.filter { !$0.key.hasPrefix(prefix) }
    closeViews(using: ended.store)
    ended.store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
  }

  private func closeViews(using store: WKWebsiteDataStore) {
    let uses = { (view: WKWebView) in view.configuration.websiteDataStore === store }
    for (key, view) in parked where uses(view) {
      parked.removeValue(forKey: key)
      Self.close(view)
    }
    for (id, view) in offered where uses(view) {
      offered.removeValue(forKey: id)
      Self.close(view)
    }
    for (key, view) in resumeHosts where uses(view) {
      resumeHosts.removeValue(forKey: key)
      Self.close(view)
    }
    for (id, pending) in pendingPermissions where pending.store === store {
      pendingPermissions.removeValue(forKey: id)
      pending.decide(false)
      ArdiaEvents.emit("permissions.dismissed", data: ["id": id])
    }
    for tab in owners.values.compactMap(\.tab) where tab.webView.map(uses) == true { tab.close() }
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
    config.websiteDataStore = dataStore(for: profile)
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
    config.preferences.isElementFullscreenEnabled = !Self.background
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.preferences.isFraudulentWebsiteWarningEnabled = false
    config.defaultWebpagePreferences.preferredContentMode = .desktop
    return config
  }

  func register(_ webView: WKWebView, tab: WebKitTab) { owners[ObjectIdentifier(webView)] = WeakTab(tab) }

  func unregister(_ webView: WKWebView) { owners.removeValue(forKey: ObjectIdentifier(webView)) }

  func owner(of webView: WKWebView) -> WebKitTab? { owners[ObjectIdentifier(webView)]?.tab }

  func noteLive(_ tab: WebKitTab, key: String) { liveByKey[key] = WeakTab(tab) }

  func forgetLive(_ tab: WebKitTab, key: String) {
    if liveByKey[key]?.tab === tab || liveByKey[key]?.tab == nil { liveByKey.removeValue(forKey: key) }
  }

  func liveTab(_ key: String) -> WebKitTab? { liveByKey[key]?.tab }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let webView = message.webView, let tab = owner(of: webView), let body = message.body as? [String: Any],
      let kind = body["kind"] as? String
    else { return }
    tab.pageMessage(kind, data: body["data"], frame: body["frame"] as? String ?? "", frameInfo: message.frameInfo)
  }

  func prepareTransfer(_ key: String) {
    transferLock.lock()
    prepared.insert(key)
    transferLock.unlock()
  }

  func releaseTransfer(_ key: String) {
    transferLock.lock()
    prepared.remove(key)
    transferLock.unlock()
    DispatchQueue.main.async {
      if let webView = self.parked.removeValue(forKey: key) { Self.close(webView) }
    }
  }

  func isPrepared(_ key: String) -> Bool {
    transferLock.lock()
    defer { transferLock.unlock() }
    return prepared.contains(key)
  }

  func park(_ webView: WKWebView, key: String) {
    if let old = parked[key], old !== webView { Self.close(old) }
    parked[key] = webView
  }

  func claimParked(_ key: String) -> WKWebView? {
    transferLock.lock()
    prepared.remove(key)
    transferLock.unlock()
    return parked.removeValue(forKey: key)
  }

  func offer(_ webView: WKWebView) -> String {
    lastOffer += 1
    let id = "webkit:\(lastOffer)"
    offered[id] = webView
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
      if let left = self?.offered.removeValue(forKey: id) { Self.close(left) }
    }
    return id
  }

  func claimOffered(_ id: String) -> WKWebView? { offered.removeValue(forKey: id) }

  static func close(_ webView: WKWebView) {
    WebKitHub.shared.unregister(webView)
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.stopLoading()
    webView.pauseAllMediaPlayback(completionHandler: nil)
    webView.closeAllMediaPresentations(completionHandler: nil)
    webView.removeFromSuperview()
  }

  func resumeHost(for profile: String) -> WKWebView {
    let key = storeKey(profile)
    if let host = resumeHosts[key] { return host }
    let host = WKWebView(frame: .zero, configuration: configuration(profile: profile))
    resumeHosts[key] = host
    return host
  }

  func zoom(profile: String, host: String) -> Double { zoomByHost[storeKey(profile) + "|" + host] ?? 1 }

  func setZoom(_ zoom: Double, profile: String, host: String) {
    let key = storeKey(profile) + "|" + host
    if zoom == 1 { zoomByHost.removeValue(forKey: key) } else { zoomByHost[key] = zoom }
  }

  static let permissionKinds = ["camera", "microphone"]

  private func permissionKey(_ profile: String, _ origin: String, _ kind: String) -> String { storeKey(profile) + "|" + origin + "|" + kind }

  func requestPermission(browserId: Int32, tabId: String?, profile: String, origin: String, kinds: [String], decide: @escaping (Bool) -> Void) {
    let keys = kinds.map { permissionKey(profile, origin, $0) }
    let answers = keys.map { rememberedPermissions[$0] }
    if answers.contains(false) { return decide(false) }
    if answers.allSatisfy({ $0 == true }) { return decide(true) }
    lastPermission += 1
    let id = "wk-permission-\(lastPermission)"
    pendingPermissions[id] = PendingPermission(browserId: browserId, keys: keys, store: dataStore(for: profile), decide: decide)
    ArdiaEvents.emit("permissions.requested", data: ["id": id, "tabId": tabId ?? NSNull(), "origin": origin, "permissions": kinds])
  }

  func resolvePermission(_ id: String, result: String, remember: Bool) {
    guard let pending = pendingPermissions.removeValue(forKey: id) else { return }
    let allowed = result == "accept"
    if remember && result != "dismiss" { for key in pending.keys { rememberedPermissions[key] = allowed } }
    pending.decide(allowed)
  }

  func dropPermissions(browserId: Int32) {
    for (id, pending) in pendingPermissions where pending.browserId == browserId {
      pendingPermissions.removeValue(forKey: id)
      pending.decide(false)
      ArdiaEvents.emit("permissions.dismissed", data: ["id": id])
    }
  }

  func sitePermissions(profile: String, origin: String) -> [String: [String: Any]] {
    var settings: [String: [String: Any]] = [:]
    for kind in Self.permissionKinds {
      let answer = rememberedPermissions[permissionKey(profile, origin, kind)]
      settings[kind] = ["value": answer.map { $0 ? "allow" : "block" } ?? "ask", "isDefault": answer == nil]
    }
    return settings
  }

  func setSitePermission(profile: String, origin: String, kind: String, value: String) {
    guard Self.permissionKinds.contains(kind) else { return }
    let key = permissionKey(profile, origin, kind)
    switch value {
    case "allow": rememberedPermissions[key] = true
    case "block": rememberedPermissions[key] = false
    default: rememberedPermissions.removeValue(forKey: key)
    }
    guard value == "block" else { return }
    let store = dataStore(for: profile)
    let views = owners.values.compactMap(\.tab?.webView) + parked.values.compactMap { $0 as? WebKitWebView } + offered.values.compactMap { $0 as? WebKitWebView }
    for view in views where view.configuration.websiteDataStore === store && view.captureOrigins[kind]?.contains(origin) == true {
      view.stopCapture(kind)
    }
  }

  func reconcileCapture(_ view: WebKitWebView, profile: String) {
    for (kind, origins) in view.captureOrigins where origins.contains(where: { rememberedPermissions[permissionKey(profile, $0, kind)] == false }) {
      view.stopCapture(kind)
    }
  }

  static let blockedSchemes: Set<String> = [
    "afp", "cifs", "disk", "disks", "hcp", "ms-help", "nfs", "res", "shell", "smb", "vbscript", "view-source", "vnc",
    "x-man-page", "x-apple.systempreferences",
  ]

  func externalAppRequest(url: URL, origin: String?, profile: String) -> [String: Any]? {
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme.isEmpty || Self.blockedSchemes.contains(scheme) {
      NSLog("[webkit] refused a link to the %@: scheme", scheme)
      return nil
    }
    let app = NSWorkspace.shared.urlForApplication(toOpen: url)
    let name = app.map { (FileManager.default.displayName(atPath: $0.path) as NSString).deletingPathExtension }
    let trusted = origin.map(Self.isTrustworthy) ?? false
    let allowance = app != nil && trusted && !Self.isPrivate(profile) ? storeKey(profile) + "|" + origin! + "|" + scheme : nil
    let grant = allowance != nil ? ExternalGrant(origin: origin!, scheme: scheme, app: name!, appPath: app!.path) : nil
    if let allowance, externalAllowances[allowance] != nil {
      open(url)
      return nil
    }
    lastExternal += 1
    let id = "wk-external-\(lastExternal)"
    if app != nil {
      if pendingExternal.count >= 50 { pendingExternal.removeAll() }
      pendingExternal[id] = PendingExternal(url: url, allowance: allowance, grant: grant)
    }
    let title = name.map { "Open “\($0)”?" } ?? "No application is set to open this link"
    let message = app == nil
      ? "Your Mac doesn’t have an app for “\(scheme):” links."
      : origin.map { "\($0) wants to open this application." } ?? "This page wants to open this application."
    let remember = allowance != nil ? "Always allow \(origin!) to open links of this type in \(name!)" : nil
    return [
      "id": id, "url": url.absoluteString, "scheme": scheme, "origin": origin ?? NSNull(), "app": name ?? NSNull(),
      "appPath": app?.path ?? NSNull(), "icon": app.flatMap(Self.iconURI) ?? NSNull(), "title": title,
      "message": message, "remember": remember ?? NSNull(),
    ]
  }

  func resolveExternalApp(_ id: String, open: Bool, remember: Bool) {
    guard let pending = pendingExternal.removeValue(forKey: id), open else { return }
    if remember, let allowance = pending.allowance, let grant = pending.grant { externalAllowances[allowance] = grant }
    self.open(pending.url)
  }

  static func isTrustworthy(_ origin: String) -> Bool {
    guard let url = URL(string: origin), let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return false }
    if scheme == "https" { return true }
    let loopback = host == "localhost" || host.hasSuffix(".localhost") || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    return scheme == "http" && loopback
  }

  func externalAppAllowances(profile: String) -> [[String: Any]] {
    let prefix = storeKey(profile) + "|"
    return externalAllowances.filter { $0.key.hasPrefix(prefix) }.values.map { grant in
      ["origin": grant.origin, "scheme": grant.scheme, "app": grant.app, "icon": Self.iconURI(URL(fileURLWithPath: grant.appPath)) ?? NSNull()]
    }
  }

  func removeExternalAppAllowance(profile: String, origin: String, scheme: String) {
    externalAllowances.removeValue(forKey: storeKey(profile) + "|" + origin + "|" + scheme)
  }

  private func open(_ url: URL) {
    if Self.background { return NSLog("[webkit] external URL (background mode, not opened): %@", url.absoluteString) }
    NSWorkspace.shared.open(url)
  }

  static func iconURI(_ app: URL) -> String? {
    let icon = NSWorkspace.shared.icon(forFile: app.path)
    let size = NSSize(width: 64, height: 64)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4,
                                     hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(origin: .zero, size: size))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:]).map { "data:image/png;base64," + $0.base64EncodedString() }
  }

  static let siteDataTypes: Set<String> = WKWebsiteDataStore.allWebsiteDataTypes().subtracting([
    WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache,
  ])

  func clearBrowsingData(profile: String, types: [String], since: Double, completion: @escaping () -> Void) {
    var kinds = Set<String>()
    if types.contains("siteData") { kinds.formUnion(Self.siteDataTypes) }
    if types.contains("cache") { kinds.formUnion([WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache]) }
    if types.contains("siteData") {
      let prefix = storeKey(profile) + "|"
      rememberedPermissions = rememberedPermissions.filter { !$0.key.hasPrefix(prefix) }
      externalAllowances = externalAllowances.filter { !$0.key.hasPrefix(prefix) }
    }
    guard !kinds.isEmpty else { return completion() }
    dataStore(for: profile).removeData(ofTypes: kinds, modifiedSince: Date(timeIntervalSince1970: since / 1000), completionHandler: completion)
  }

  static func covers(_ domain: String, host: String) -> Bool {
    let name = domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
    return !name.isEmpty && (host == name || host.hasSuffix("." + name))
  }

  func clearSiteData(profile: String, host rawHost: String, completion: @escaping ([String: Any]) -> Void) {
    let store = dataStore(for: profile)
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
    guard !Self.isPrivate(profile) else { return completion(true) }
    let identifier = Self.storeIdentifier(profile)
    deletedProfileStores[profile] = .nonPersistent()
    downloads.cancelAll(profile: profile)
    if let host = resumeHosts.removeValue(forKey: profile) { Self.close(host) }
    let removeStore = {
      WebKitStoreRemovals.exists(identifier) { exists in
        guard exists else { return completion(true) }
        WebKitStoreRemovals.remove(identifier, tries: 12, done: completion)
      }
    }
    guard let store = persistentStores.removeValue(forKey: profile) else { return removeStore() }
    closeViews(using: store)
    store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { DispatchQueue.main.async(execute: removeStore) }
  }

  func storeExists(_ profile: String, done: @escaping (Bool) -> Void) {
    WebKitStoreRemovals.exists(Self.storeIdentifier(profile), done: done)
  }

  func holdStoreForTest(_ profile: String) { storesHeldForTest[profile] = dataStore(for: profile) }

  func touchStore(_ profile: String, done: @escaping (Bool) -> Void) {
    let cookies = dataStore(for: profile).httpCookieStore
    let cookie = HTTPCookie(properties: [.name: "ardia-touch", .value: "1", .domain: "ardia.test", .path: "/", .expires: Date().addingTimeInterval(86400)])
    cookies.getAllCookies { existing in
      let touched = existing.contains { $0.name == "ardia-touch" && $0.domain.hasSuffix("ardia.test") }
      guard let cookie else { return done(touched) }
      cookies.setCookie(cookie) { done(touched) }
    }
  }
}

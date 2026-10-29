import CryptoKit
import WebKit

final class WebKitStores {
  enum StoreID: Hashable {
    case profile(String)
    case privateSession(name: String, token: String)

    var wireKey: String {
      switch self {
      case .profile(let name): name
      case .privateSession(let name, let token): "private@\(name)#\(token)"
      }
    }
  }

  struct SiteKey: Hashable {
    let site: String
    let kind: String
  }

  struct ExternalGrant {
    let origin: String
    let scheme: String
    let app: String
    let appPath: String
  }

  struct StoreState {
    var remembered: [SiteKey: Bool] = [:]
    var zoom: [String: Double] = [:]
    var externalAllowances: [SiteKey: ExternalGrant] = [:]
  }

  private struct PrivateSession {
    let store: WKWebsiteDataStore
    let token: String
  }

  private var persistent: [String: WKWebsiteDataStore] = [:]
  private var privateSessions: [String: PrivateSession] = [:]
  private var deletedProfiles: [String: WKWebsiteDataStore] = [:]
  private var heldForTest: [String: WKWebsiteDataStore] = [:]
  private var resumeHosts: [StoreID: WKWebView] = [:]
  private var states: [StoreID: StoreState] = [:]

  static func isPrivate(_ profile: String) -> Bool { ArdiaHost.isPrivateProfile(profile) }

  private func session(_ name: String) -> PrivateSession {
    if let live = privateSessions[name] { return live }
    let made = PrivateSession(store: .nonPersistent(), token: UUID().uuidString)
    privateSessions[name] = made
    return made
  }

  func id(of profile: String) -> StoreID {
    guard Self.isPrivate(profile) else { return .profile(profile) }
    let name = ArdiaHost.baseProfile(of: profile)
    return .privateSession(name: name, token: session(name).token)
  }

  func isLive(_ id: StoreID) -> Bool {
    switch id {
    case .profile: true
    case .privateSession(let name, let token): privateSessions[name]?.token == token
    }
  }

  static func storeIdentifier(_ profile: String) -> UUID {
    let scope = LaunchConfig.shared.dataDirectory ?? ""
    var bytes = Array(SHA256.hash(data: Data("ardia.webkit|\(scope)|\(profile)".utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x50
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return bytes.withUnsafeBufferPointer { NSUUID(uuidBytes: $0.baseAddress!) as UUID }
  }

  func dataStore(for profile: String) -> WKWebsiteDataStore {
    if Self.isPrivate(profile) { return session(ArdiaHost.baseProfile(of: profile)).store }
    if let store = persistent[profile] ?? deletedProfiles[profile] { return store }
    let store = WKWebsiteDataStore(forIdentifier: Self.storeIdentifier(profile))
    persistent[profile] = store
    return store
  }

  func liveDataStore(for profile: String, wireKey: String) -> WKWebsiteDataStore? {
    guard Self.isPrivate(profile) else { return wireKey == profile ? dataStore(for: profile) : nil }
    let name = ArdiaHost.baseProfile(of: profile)
    guard let live = privateSessions[name], wireKey == StoreID.privateSession(name: name, token: live.token).wireKey else { return nil }
    return live.store
  }

  func state(_ id: StoreID) -> StoreState { states[id] ?? StoreState() }

  func update(_ id: StoreID, _ change: (inout StoreState) -> Void) {
    guard isLive(id) else { return }
    var state = states[id] ?? StoreState()
    change(&state)
    states[id] = state
  }

  func zoom(profile: String, host: String) -> Double { state(id(of: profile)).zoom[host] ?? 1 }

  func setZoom(_ zoom: Double, profile: String, host: String) {
    update(id(of: profile)) { state in
      if zoom == 1 { state.zoom.removeValue(forKey: host) } else { state.zoom[host] = zoom }
    }
  }

  func forgetSitePermissions(of profile: String) {
    update(id(of: profile)) { state in
      state.remembered = [:]
      state.externalAllowances = [:]
    }
  }

  func endPrivateSession(_ name: String) -> (id: StoreID, store: WKWebsiteDataStore)? {
    guard let ended = privateSessions.removeValue(forKey: name) else { return nil }
    let id = StoreID.privateSession(name: name, token: ended.token)
    states.removeValue(forKey: id)
    return (id, ended.store)
  }

  func resumeHost(for profile: String, configuration: () -> WKWebViewConfiguration) -> WKWebView {
    let id = id(of: profile)
    if let host = resumeHosts[id] { return host }
    let host = WKWebView(frame: .zero, configuration: configuration())
    resumeHosts[id] = host
    return host
  }

  func takeResumeHosts(using store: WKWebsiteDataStore) -> [WKWebView] {
    let using = resumeHosts.filter { $0.value.configuration.websiteDataStore === store }
    for id in using.keys { resumeHosts.removeValue(forKey: id) }
    return Array(using.values)
  }

  func takeResumeHost(of profile: String) -> WKWebView? { resumeHosts.removeValue(forKey: .profile(profile)) }

  func forgetProfile(_ profile: String) -> WKWebsiteDataStore? {
    deletedProfiles[profile] = .nonPersistent()
    return persistent.removeValue(forKey: profile)
  }

  func holdForTest(_ profile: String) { heldForTest[profile] = dataStore(for: profile) }
}

import AppKit

final class WebKitExternalApps {
  typealias StoreID = WebKitStores.StoreID
  typealias SiteKey = WebKitStores.SiteKey
  typealias Grant = WebKitStores.ExternalGrant

  private struct Pending {
    let url: URL
    let rememberable: (store: StoreID, key: SiteKey, grant: Grant)?
  }

  static let blockedSchemes: Set<String> = [
    "afp", "cifs", "disk", "disks", "hcp", "ms-help", "nfs", "res", "shell", "smb", "vbscript", "view-source", "vnc",
    "x-man-page", "x-apple.systempreferences",
  ]
  private static let pendingLimit = 50

  private unowned let stores: WebKitStores
  private var pending: [String: Pending] = [:]
  private var lastRequest = 0

  init(stores: WebKitStores) {
    self.stores = stores
  }

  func request(url: URL, origin: String?, profile: String) -> [String: Any]? {
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme.isEmpty || Self.blockedSchemes.contains(scheme) {
      NSLog("[webkit] refused a link to the %@: scheme", scheme)
      return nil
    }
    let app = NSWorkspace.shared.urlForApplication(toOpen: url)
    let name = app.map { (FileManager.default.displayName(atPath: $0.path) as NSString).deletingPathExtension }
    let trusted = origin.map(Self.isTrustworthy) ?? false
    var rememberable: (store: StoreID, key: SiteKey, grant: Grant)?
    if let app, let name, let origin, trusted, !WebKitStores.isPrivate(profile) {
      rememberable = (stores.id(of: profile), SiteKey(site: origin, kind: scheme), Grant(origin: origin, scheme: scheme, app: name, appPath: app.path))
    }
    if let rememberable, stores.state(rememberable.store).externalAllowances[rememberable.key] != nil {
      open(url)
      return nil
    }
    lastRequest += 1
    let id = "wk-external-\(lastRequest)"
    if app != nil {
      if pending.count >= Self.pendingLimit { pending.removeAll() }
      pending[id] = Pending(url: url, rememberable: rememberable)
    }
    let title = name.map { "Open “\($0)”?" } ?? "No application is set to open this link"
    let message = app == nil
      ? "Your Mac doesn’t have an app for “\(scheme):” links."
      : origin.map { "\($0) wants to open this application." } ?? "This page wants to open this application."
    let remember = rememberable.map { "Always allow \($0.grant.origin) to open links of this type in \($0.grant.app)" }
    return [
      "id": id, "url": url.absoluteString, "scheme": scheme, "origin": origin ?? NSNull(), "app": name ?? NSNull(),
      "appPath": app?.path ?? NSNull(), "icon": app.flatMap(Self.iconURI) ?? NSNull(), "title": title,
      "message": message, "remember": remember ?? NSNull(),
    ]
  }

  func resolve(_ id: String, open: Bool, remember: Bool) {
    guard let request = pending.removeValue(forKey: id), open else { return }
    if remember, let rememberable = request.rememberable {
      stores.update(rememberable.store) { $0.externalAllowances[rememberable.key] = rememberable.grant }
    }
    self.open(request.url)
  }

  static func isTrustworthy(_ origin: String) -> Bool {
    guard let url = URL(string: origin), let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return false }
    if scheme == "https" { return true }
    let loopback = host == "localhost" || host.hasSuffix(".localhost") || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    return scheme == "http" && loopback
  }

  func allowances(profile: String) -> [[String: Any]] {
    stores.state(stores.id(of: profile)).externalAllowances.values.map { grant in
      ["origin": grant.origin, "scheme": grant.scheme, "app": grant.app, "icon": Self.iconURI(URL(fileURLWithPath: grant.appPath)) ?? NSNull()]
    }
  }

  func removeAllowance(profile: String, origin: String, scheme: String) {
    stores.update(stores.id(of: profile)) { $0.externalAllowances.removeValue(forKey: SiteKey(site: origin, kind: scheme)) }
  }

  private func open(_ url: URL) {
    if LaunchConfig.shared.background { return NSLog("[webkit] external URL (background mode, not opened): %@", url.absoluteString) }
    NSWorkspace.shared.open(url)
  }

  static func iconURI(_ app: URL) -> String? {
    NSWorkspace.shared.icon(forFile: app.path).pngDataURL(points: 64, scale: 1)
  }
}

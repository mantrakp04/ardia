import Foundation
import Observation
import OSLog
import WebKit

public enum NightShadeMode: String, Codable, Sendable, CaseIterable, Identifiable {
  case disabled
  case automatic
  case always

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .disabled: String(localized: "Off")
    case .automatic: String(localized: "Automatic")
    case .always: String(localized: "Always")
    }
  }
}

public enum SwipeNavigationMode: String, Codable, Sendable, CaseIterable, Identifiable {
  case anywhere
  case screenEdges
  case disabled

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .anywhere: String(localized: "From Anywhere")
    case .screenEdges: String(localized: "From Screen Edges")
    case .disabled: String(localized: "Off")
    }
  }
}

public enum AppLinkPreference: String, Codable, Sendable, CaseIterable, Identifiable {
  case ardia
  case app

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .ardia: String(localized: "Ardia")
    case .app: String(localized: "App")
    }
  }
}

public struct SiteSettings: Codable, Equatable, Sendable {
  public var pageZoom: Double?
  public var nightShade: NightShadeMode?
  public var appLinks: AppLinkPreference?

  public init(pageZoom: Double? = nil, nightShade: NightShadeMode? = nil, appLinks: AppLinkPreference? = nil) {
    self.pageZoom = pageZoom
    self.nightShade = nightShade
    self.appLinks = appLinks
  }

  var isEmpty: Bool { pageZoom == nil && nightShade == nil && appLinks == nil }
}

@MainActor
@Observable
public final class BrowsingPreferences {
  static let keys = (
    nightShade: "browsing.nightShade", swipe: "browsing.swipeNavigation", appLinks: "browsing.appLinks",
    suggestions: "browsing.searchSuggestions", engine: "browsing.searchEngine", sites: "browsing.sites",
    permissions: "browsing.sitePermissions"
  )
  static let siteLimit = 500

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored var onNightShadeChange: (@MainActor () -> Void)?
  @ObservationIgnored var onSwipeNavigationChange: (@MainActor () -> Void)?

  public var nightShade: NightShadeMode {
    didSet {
      defaults.set(nightShade.rawValue, forKey: Self.keys.nightShade)
      if nightShade != oldValue { onNightShadeChange?() }
    }
  }

  public var swipeNavigation: SwipeNavigationMode {
    didSet {
      defaults.set(swipeNavigation.rawValue, forKey: Self.keys.swipe)
      if swipeNavigation != oldValue { onSwipeNavigationChange?() }
    }
  }

  public var appLinks: AppLinkPreference {
    didSet { defaults.set(appLinks.rawValue, forKey: Self.keys.appLinks) }
  }

  public var searchSuggestions: Bool {
    didSet { defaults.set(searchSuggestions, forKey: Self.keys.suggestions) }
  }

  public var searchEngineID: String {
    didSet { defaults.set(searchEngineID, forKey: Self.keys.engine) }
  }

  public private(set) var sites: [String: SiteSettings]
  public private(set) var sitePermissions: [String: Set<SitePermission>]
  private var privateSites: [String: SiteSettings] = [:]

  public init(defaults: UserDefaults) {
    self.defaults = defaults
    nightShade = defaults.string(forKey: Self.keys.nightShade).flatMap(NightShadeMode.init(rawValue:)) ?? .disabled
    swipeNavigation = defaults.string(forKey: Self.keys.swipe).flatMap(SwipeNavigationMode.init(rawValue:)) ?? .anywhere
    appLinks = defaults.string(forKey: Self.keys.appLinks).flatMap(AppLinkPreference.init(rawValue:)) ?? .ardia
    searchSuggestions = defaults.object(forKey: Self.keys.suggestions) as? Bool ?? true
    searchEngineID = defaults.string(forKey: Self.keys.engine) ?? "google"
    let storedSites = defaults.data(forKey: Self.keys.sites)
    sites = storedSites.flatMap { try? JSONDecoder().decode([String: SiteSettings].self, from: $0) } ?? [:]
    sitePermissions = (defaults.data(forKey: Self.keys.permissions)).flatMap { try? JSONDecoder().decode([String: Set<SitePermission>].self, from: $0) } ?? [:]
    if Self.holdsEarlierGrants(storedSites) { saveSites() }
  }

  private struct EarlierSiteGrants: Decodable {
    var permissions: [String]?
  }

  private static func holdsEarlierGrants(_ data: Data?) -> Bool {
    guard let data, let decoded = try? JSONDecoder().decode([String: EarlierSiteGrants].self, from: data) else { return false }
    return decoded.values.contains { $0.permissions != nil }
  }

  private func saveSites() {
    do {
      defaults.set(try JSONEncoder().encode(sites), forKey: Self.keys.sites)
    } catch {
      Logger(subsystem: "com.ardia.browser.ios", category: "permissions").error("Couldn't save site settings: \(error.localizedDescription, privacy: .public)")
    }
  }

  public func settings(for host: String?, isPrivate: Bool = false) -> SiteSettings {
    guard let host else { return SiteSettings() }
    let key = BlockingSettings.normalize(host)
    return (isPrivate ? privateSites[key] : nil) ?? sites[key] ?? SiteSettings()
  }

  public func nightShade(for host: String?, isPrivate: Bool = false) -> NightShadeMode {
    settings(for: host, isPrivate: isPrivate).nightShade ?? nightShade
  }

  public func appLinks(for host: String?, isPrivate: Bool = false) -> AppLinkPreference {
    settings(for: host, isPrivate: isPrivate).appLinks ?? appLinks
  }

  public var permissionGrants: [SitePermissionGrant] {
    sitePermissions
      .compactMap { site, permissions in
        permissions.isEmpty ? nil : SitePermissionGrant(host: site, permissions: permissions.sorted())
      }
      .sorted { $0.host.localizedStandardCompare($1.host) == .orderedAscending }
  }

  public func isGranted(_ permissions: Set<SitePermission>, host: String) -> Bool {
    permissions.isSubset(of: sitePermissions[SitePermissionSite.normalize(host)] ?? [])
  }

  public func grant(_ permissions: Set<SitePermission>, host: String) {
    let site = SitePermissionSite.normalize(host)
    guard !site.isEmpty else { return }
    savePermissions(sitePermissions.merging([site: (sitePermissions[site] ?? []).union(permissions)]) { $1 })
  }

  public func revoke(_ permissions: Set<SitePermission>, host: String) {
    let site = SitePermissionSite.normalize(host)
    guard let granted = sitePermissions[site] else { return }
    let left = granted.subtracting(permissions)
    savePermissions(left.isEmpty ? sitePermissions.filter { $0.key != site } : sitePermissions.merging([site: left]) { $1 })
  }

  private func savePermissions(_ updated: [String: Set<SitePermission>]) {
    guard updated != sitePermissions else { return }
    sitePermissions = updated
    do {
      defaults.set(try JSONEncoder().encode(updated), forKey: Self.keys.permissions)
    } catch {
      Logger(subsystem: "com.ardia.browser.ios", category: "permissions").error("Couldn't save site permissions: \(error.localizedDescription, privacy: .public)")
    }
  }

  public func endPrivateBrowsing() {
    let hadNightShade = privateSites.values.contains { $0.nightShade != nil }
    privateSites.removeAll()
    if hadNightShade { onNightShadeChange?() }
  }

  public func update(_ host: String, isPrivate: Bool = false, _ change: (inout SiteSettings) -> Void) {
    let key = BlockingSettings.normalize(host)
    guard !key.isEmpty else { return }
    if isPrivate {
      let before = settings(for: host, isPrivate: true)
      var value = before
      change(&value)
      guard value != before else { return }
      privateSites[key] = value
      if before.nightShade != value.nightShade { onNightShadeChange?() }
      return
    }
    var value = sites[key] ?? SiteSettings()
    let before = value
    change(&value)
    guard value != before else { return }
    if value.isEmpty { sites[key] = nil } else { sites[key] = value }
    if sites.count > Self.siteLimit, let drop = sites.keys.first(where: { $0 != key }) { sites[drop] = nil }
    saveSites()
    if before.nightShade != value.nightShade { onNightShadeChange?() }
  }
}

public enum BrowsingDataKind: String, CaseIterable, Sendable, Identifiable {
  case history
  case cache
  case cookiesAndSiteData

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .history: String(localized: "History")
    case .cache: String(localized: "Cache")
    case .cookiesAndSiteData: String(localized: "Cookies and Site Data")
    }
  }
}

public enum BrowsingDataCleaner {
  @MainActor
  public static func clear(_ kinds: Set<BrowsingDataKind>, since date: Date? = nil, tabs: TabStore, store: WKWebsiteDataStore = .default()) async {
    let cacheTypes: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache, WKWebsiteDataTypeOfflineWebApplicationCache]
    var types: Set<String> = []
    if kinds.contains(.cache) { types.formUnion(cacheTypes) }
    if kinds.contains(.cookiesAndSiteData) { types.formUnion(WKWebsiteDataStore.allWebsiteDataTypes().subtracting(cacheTypes)) }
    if kinds.contains(.history) {
      do {
        try HistoryEraser.erase(since: date, at: tabs.now(), in: tabs.context)
      } catch {
        Logger(subsystem: "com.ardia.browser.ios", category: "history").error("Couldn't clear history: \(error.localizedDescription, privacy: .public)")
        tabs.clearHistory(since: date)
      }
    }
    if kinds.contains(.cache) { URLCache.shared.removeAllCachedResponses() }
    guard !types.isEmpty else { return }
    await store.removeData(ofTypes: types, modifiedSince: date ?? .distantPast)
    await clearLeftoverStores(ofTypes: types, since: date, removing: date == nil && kinds.isSuperset(of: [.cache, .cookiesAndSiteData]))
  }

  @MainActor
  static func clearLeftoverStores(ofTypes types: Set<String>, since date: Date?, removing: Bool) async {
    let identifiers = await WKWebsiteDataStore.allDataStoreIdentifiers
    for identifier in identifiers {
      await WKWebsiteDataStore(forIdentifier: identifier).removeData(ofTypes: types, modifiedSince: date ?? .distantPast)
    }
    guard removing else { return }
    for identifier in identifiers {
      do {
        try await WKWebsiteDataStore.remove(forIdentifier: identifier)
      } catch {
        Logger(subsystem: "com.ardia.browser.ios", category: "browsingData").error("Couldn’t remove a leftover website data store: \(error.localizedDescription, privacy: .public)")
      }
    }
  }
}

public enum SwipeNavigationDirection: Sendable, Equatable {
  case back
  case forward
}

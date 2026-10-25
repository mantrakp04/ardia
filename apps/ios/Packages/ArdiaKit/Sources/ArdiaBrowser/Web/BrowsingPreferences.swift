import Foundation
import Observation
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
    suggestions: "browsing.searchSuggestions", engine: "browsing.searchEngine", sites: "browsing.sites"
  )
  static let siteLimit = 500

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored var onNightShadeChange: (@MainActor () -> Void)?

  public var nightShade: NightShadeMode {
    didSet {
      defaults.set(nightShade.rawValue, forKey: Self.keys.nightShade)
      if nightShade != oldValue { onNightShadeChange?() }
    }
  }

  public var swipeNavigation: SwipeNavigationMode {
    didSet { defaults.set(swipeNavigation.rawValue, forKey: Self.keys.swipe) }
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

  public init(defaults: UserDefaults) {
    self.defaults = defaults
    nightShade = defaults.string(forKey: Self.keys.nightShade).flatMap(NightShadeMode.init(rawValue:)) ?? .disabled
    swipeNavigation = defaults.string(forKey: Self.keys.swipe).flatMap(SwipeNavigationMode.init(rawValue:)) ?? .anywhere
    appLinks = defaults.string(forKey: Self.keys.appLinks).flatMap(AppLinkPreference.init(rawValue:)) ?? .ardia
    searchSuggestions = defaults.object(forKey: Self.keys.suggestions) as? Bool ?? true
    searchEngineID = defaults.string(forKey: Self.keys.engine) ?? "google"
    sites = (defaults.data(forKey: Self.keys.sites)).flatMap { try? JSONDecoder().decode([String: SiteSettings].self, from: $0) } ?? [:]
  }

  public func settings(for host: String?) -> SiteSettings {
    guard let host else { return SiteSettings() }
    return sites[BlockingSettings.normalize(host)] ?? SiteSettings()
  }

  public func nightShade(for host: String?) -> NightShadeMode {
    settings(for: host).nightShade ?? nightShade
  }

  public func appLinks(for host: String?) -> AppLinkPreference {
    settings(for: host).appLinks ?? appLinks
  }

  public func update(_ host: String, _ change: (inout SiteSettings) -> Void) {
    let key = BlockingSettings.normalize(host)
    guard !key.isEmpty else { return }
    var value = sites[key] ?? SiteSettings()
    let before = value
    change(&value)
    guard value != before else { return }
    if value.isEmpty { sites[key] = nil } else { sites[key] = value }
    if sites.count > Self.siteLimit, let drop = sites.keys.first(where: { $0 != key }) { sites[drop] = nil }
    if let data = try? JSONEncoder().encode(sites) { defaults.set(data, forKey: Self.keys.sites) }
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
    if kinds.contains(.history) { tabs.clearHistory(since: date) }
    if kinds.contains(.cache) { URLCache.shared.removeAllCachedResponses() }
    guard !types.isEmpty else { return }
    await store.removeData(ofTypes: types, modifiedSince: date ?? .distantPast)
  }
}

public enum SwipeNavigationDirection: Sendable, Equatable {
  case back
  case forward
}

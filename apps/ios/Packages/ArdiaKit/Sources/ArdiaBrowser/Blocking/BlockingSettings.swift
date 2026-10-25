import Foundation
import Observation

public enum BlockingCategory: String, CaseIterable, Codable, Sendable {
  case ads
  case trackers
  case cookieBanners

  var identifier: String { "ardia.\(rawValue)" }

  var sourceURL: URL {
    switch self {
    case .ads: URL(string: "https://easylist.to/easylist/easylist.txt")!
    case .trackers: URL(string: "https://easylist.to/easylist/easyprivacy.txt")!
    case .cookieBanners: URL(string: "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt")!
    }
  }
}

@MainActor
@Observable
public final class BlockingSettings {
  static let keys = (ads: "blocking.ads", trackers: "blocking.trackers", cookies: "blocking.cookieBanners", exempt: "blocking.exemptHosts")

  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored var onChange: (@MainActor () -> Void)?

  public var blocksAds: Bool {
    didSet { save(blocksAds, Self.keys.ads, changed: blocksAds != oldValue) }
  }

  public var blocksTrackers: Bool {
    didSet { save(blocksTrackers, Self.keys.trackers, changed: blocksTrackers != oldValue) }
  }

  public var hidesCookieBanners: Bool {
    didSet { save(hidesCookieBanners, Self.keys.cookies, changed: hidesCookieBanners != oldValue) }
  }

  public private(set) var exemptHosts: Set<String>

  public init(defaults: UserDefaults) {
    self.defaults = defaults
    blocksAds = defaults.object(forKey: Self.keys.ads) as? Bool ?? true
    blocksTrackers = defaults.object(forKey: Self.keys.trackers) as? Bool ?? true
    hidesCookieBanners = defaults.object(forKey: Self.keys.cookies) as? Bool ?? true
    exemptHosts = Set(defaults.stringArray(forKey: Self.keys.exempt) ?? [])
  }

  public func isEnabled(_ category: BlockingCategory) -> Bool {
    switch category {
    case .ads: blocksAds
    case .trackers: blocksTrackers
    case .cookieBanners: hidesCookieBanners
    }
  }

  public func isExempt(_ host: String?) -> Bool {
    guard let host = host.map(Self.normalize), !host.isEmpty, !exemptHosts.isEmpty else { return false }
    var candidate = Substring(host)
    while true {
      if exemptHosts.contains(String(candidate)) { return true }
      guard let dot = candidate.firstIndex(of: ".") else { return false }
      candidate = candidate[candidate.index(after: dot)...]
    }
  }

  public func setExempt(_ host: String, _ exempt: Bool) {
    let key = Self.normalize(host)
    guard !key.isEmpty else { return }
    let before = exemptHosts
    if exempt { exemptHosts.insert(key) } else { exemptHosts.remove(key) }
    guard exemptHosts != before else { return }
    defaults.set(exemptHosts.sorted(), forKey: Self.keys.exempt)
    onChange?()
  }

  static func normalize(_ host: String) -> String {
    let lower = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ". "))
    return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
  }

  private func save(_ value: Bool, _ key: String, changed: Bool) {
    defaults.set(value, forKey: key)
    if changed { onChange?() }
  }
}

@MainActor
@Observable
public final class BlockedResourceCounter {
  public private(set) var count = 0

  public init() {}

  public func reset() {
    if count != 0 { count = 0 }
  }

  func add(_ amount: Int) {
    if amount > 0 { count += amount }
  }
}

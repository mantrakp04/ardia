import ArdiaSync
import Foundation

public enum AutoArchiveInterval: String, Codable, Sendable, CaseIterable, Identifiable {
  case oneHour
  case fourHours
  case twelveHours
  case day
  case threeDays
  case week
  case never

  public static let standard: AutoArchiveInterval = .day

  public var id: String { rawValue }

  public var duration: TimeInterval? {
    switch self {
    case .oneHour: 3600
    case .fourHours: 4 * 3600
    case .twelveHours: 12 * 3600
    case .day: 24 * 3600
    case .threeDays: 3 * 24 * 3600
    case .week: 7 * 24 * 3600
    case .never: nil
    }
  }

  public var title: String {
    guard let duration else { return String(localized: "Never") }
    let units: Set<Duration.UnitsFormatStyle.Unit> = duration >= 24 * 3600 ? [.days] : [.hours]
    let amount = Duration.seconds(duration).formatted(.units(allowed: units, width: .wide))
    return String(localized: "After \(amount)")
  }
}

public enum AutoArchivePolicy {
  public static func isDue(lastActive: Date, now: Date, interval: AutoArchiveInterval, isBeingViewed: Bool) -> Bool {
    guard !isBeingViewed, let duration = interval.duration else { return false }
    guard lastActive <= now else { return false }
    return now.timeIntervalSince(lastActive) >= duration
  }
}

public enum TabDestination: Sendable, Equatable {
  case url(URL, origin: TabOrigin = .typed)
  case search(String)
  case browseForMe(query: String, resultID: UUID)
  case sent(ReceivedTab)
}

public enum TabPlacement: Sendable, Equatable {
  case end
  case after(UUID)
}

public struct ArchivedDay: Identifiable {
  public var day: Date
  public var tabs: [BrowserTab]
  public var id: Date { day }
}

public enum BrowserURL {
  public static let browseScheme = "ardia"

  public static func browseForMe(_ resultID: UUID) -> String {
    "ardia://browse/\(resultID.uuidString)"
  }

  public static func isSyncable(_ url: String) -> Bool {
    let lower = url.lowercased()
    return lower.hasPrefix("https://") || lower.hasPrefix("http://")
  }

  public static func searchURL(template: String, query: String) -> String {
    let encoded = encodeURIComponent(query.trimmingCharacters(in: .whitespacesAndNewlines))
    return template.contains("%s") ? template.replacingOccurrences(of: "%s", with: encoded) : template + encoded
  }

  static func encodeURIComponent(_ text: String) -> String {
    var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    allowed.insert(charactersIn: "-_.!~*'()")
    return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
  }

  public static func host(of url: String) -> String? {
    guard let host = URLComponents(string: url)?.host?.lowercased() else { return nil }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }
}

enum TabPositions {
  static let step = 1024.0

  static func between(_ lower: Double?, _ upper: Double?) -> Double? {
    switch (lower, upper) {
    case (nil, nil): return 0
    case (let lower?, nil): return lower + step
    case (nil, let upper?): return upper - step
    case (let lower?, let upper?):
      let middle = (lower + upper) / 2
      return middle > lower && middle < upper && upper - lower > 1e-6 ? middle : nil
    }
  }
}

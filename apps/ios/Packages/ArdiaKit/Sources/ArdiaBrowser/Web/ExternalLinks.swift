import Foundation

public enum ExternalApp: String, Sendable, Equatable {
  case phone
  case mail
  case messages
  case faceTime
  case maps
  case appStore
  case other

  public var name: String {
    switch self {
    case .phone: String(localized: "Phone")
    case .mail: String(localized: "Mail")
    case .messages: String(localized: "Messages")
    case .faceTime: String(localized: "FaceTime")
    case .maps: String(localized: "Maps")
    case .appStore: String(localized: "App Store")
    case .other: String(localized: "Another App")
    }
  }
}

public enum LinkRoute: Sendable, Equatable {
  case web
  case external(ExternalApp)
  case blocked
}

public enum ExternalLinks {
  static let webSchemes: Set<String> = ["http", "https", "about", "data", "blob", "file", "ardia"]
  static let blockedSchemes: Set<String> = ["javascript", "vbscript"]

  public static func route(_ url: URL, isMainFrame: Bool = true) -> LinkRoute {
    guard let scheme = url.scheme?.lowercased() else { return .blocked }
    if blockedSchemes.contains(scheme) { return isMainFrame ? .blocked : .web }
    if webSchemes.contains(scheme) {
      if scheme == "https", isMainFrame, let host = url.host?.lowercased(), host == "apps.apple.com" || host == "itunes.apple.com" {
        return .external(.appStore)
      }
      return .web
    }
    switch scheme {
    case "tel", "telprompt": return .external(.phone)
    case "mailto": return .external(.mail)
    case "sms", "imessage": return .external(.messages)
    case "facetime", "facetime-audio": return .external(.faceTime)
    case "maps": return .external(.maps)
    case "itms-apps", "itms-appss", "itms", "itmss": return .external(.appStore)
    default: return isMainFrame ? .external(.other) : .blocked
    }
  }
}

public enum BrowserUserAgent {
  public static let applicationName = "Version/27.0 Mobile/15E148 Safari/604.1"
}

struct ProgressThrottle {
  var minimumInterval: TimeInterval = 0.1
  private(set) var published = 0.0
  private var lastPublish = Date.distantPast

  mutating func offer(_ raw: Double, at date: Date) -> Double? {
    let whole = (max(0, min(1, raw)) * 100).rounded(.down) / 100
    guard whole != published else { return nil }
    let finishing = whole >= 1 || whole == 0
    guard finishing || date.timeIntervalSince(lastPublish) >= minimumInterval else { return nil }
    published = whole
    lastPublish = date
    return whole
  }

  mutating func reset() {
    published = 0
    lastPublish = .distantPast
  }
}

public enum ScrollDirection: Sendable, Equatable {
  case up
  case down
}

struct ScrollDirectionTracker {
  var threshold: Double = 24
  private(set) var direction: ScrollDirection = .up
  private var anchor: Double = 0

  mutating func offer(offset: Double, contentHeight: Double, viewportHeight: Double) -> ScrollDirection? {
    let maxOffset = max(0, contentHeight - viewportHeight)
    if offset <= 0 {
      anchor = 0
      return update(.up)
    }
    if offset >= maxOffset - 1, maxOffset > 0 {
      anchor = offset
      return nil
    }
    let delta = offset - anchor
    if direction == .up ? delta > threshold : delta < -threshold {
      anchor = offset
      return update(delta > 0 ? .down : .up)
    }
    if direction == .down ? delta > 0 : delta < 0 { anchor = offset }
    return nil
  }

  mutating func reset() {
    direction = .up
    anchor = 0
  }

  private mutating func update(_ next: ScrollDirection) -> ScrollDirection? {
    guard next != direction else { return nil }
    direction = next
    return next
  }
}

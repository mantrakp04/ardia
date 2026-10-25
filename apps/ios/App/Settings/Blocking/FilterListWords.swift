import ArdiaBrowser
import SwiftUI

enum FilterListWords {
  static func rules(_ count: Int) -> String {
    String(AttributedString(localized: "^[\(count) rule](inflect: true)").characters)
  }

  static func lists(_ count: Int) -> String {
    String(AttributedString(localized: "^[\(count) list](inflect: true)").characters)
  }

  static func summary(lists count: Int, rules: Int) -> String {
    "\(lists(count)) · \(Self.rules(rules))"
  }

  static func updated(_ date: Date?, now: Date = .now) -> String {
    guard let date else { return String(localized: "Not updated yet") }
    if now.timeIntervalSince(date) < 60 { return String(localized: "Updated just now") }
    return String(localized: "Updated \(date.formatted(.relative(presentation: .named, unitsStyle: .wide)))")
  }

  static func status(isUpdating: Bool, isOffline: Bool, lastUpdated: Date?) -> String {
    if isUpdating { return String(localized: "Updating…") }
    if isOffline { return String(localized: "Offline · \(updated(lastUpdated))") }
    return updated(lastUpdated)
  }

  static func facts(_ list: FilterListInfo) -> Text {
    switch list.state {
    case .downloading:
      return Text("Downloading…")
    case .compiling:
      return Text("Compiling…")
    case .failed:
      return Text("Couldn’t update").foregroundStyle(.ink(.orange))
    case .offline:
      return Text("\(rules(list.ruleCount)) · Waiting for a connection")
    case .ready:
      guard list.isEnabled || list.updatedAt != nil else { return Text("Downloads when you turn it on") }
      return Text("\(rules(list.ruleCount)) · \(updated(list.updatedAt))")
    }
  }
}

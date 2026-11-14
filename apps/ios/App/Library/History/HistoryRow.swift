import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct HistoryRow: View {
  let entry: HistoryEntry
  let synced: SyncedOrigin
  @ScaledMetric(relativeTo: .body) private var iconSize = 20
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.l) {
      FaviconImage(iconURL: nil, pageURL: entry.url, size: iconSize)
        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + iconSize * 0.25 }
      VStack(alignment: .leading, spacing: Tokens.Space.xxs) {
        Text(entry.displayTitle)
          .typography(.body)
          .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
        HStack(spacing: Tokens.Space.xs) {
          Image(systemName: HistoryWords.sourceSymbol(entry.source, synced: synced))
            .imageScale(.small)
          Text(facts)
            .lineLimit(1)
        }
        .typography(.caption)
        .foregroundStyle(Tokens.Role.textSecondary)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, Tokens.Space.xs)
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(entry.displayTitle)
    .accessibilityValue(String(localized: "\(entry.host), \(entry.lastVisit.formatted(date: .omitted, time: .shortened)), \(HistoryWords.sourceName(entry.source, synced: synced))"))
  }

  private var facts: String {
    String(localized: "\(entry.host) · \(entry.lastVisit.formatted(date: .omitted, time: .shortened))")
  }
}

struct SyncedOrigin: Equatable {
  let name: String
  let symbol: String

  init(devices: [SyncedDevice]) {
    let others = devices.filter { !$0.isCurrent }
    if let only = others.first, others.count == 1, only.kind == .mac {
      name = only.name
      symbol = "laptopcomputer"
    } else if !others.isEmpty, others.allSatisfy({ $0.kind == .mac }) {
      name = String(localized: "Your Macs")
      symbol = "laptopcomputer"
    } else if let only = others.first, others.count == 1, only.kind == .tablet {
      name = only.name
      symbol = "ipad"
    } else if !others.isEmpty, others.allSatisfy({ $0.kind == .tablet }) {
      name = String(localized: "Your iPads")
      symbol = "ipad"
    } else {
      name = String(localized: "Your Other Devices")
      symbol = "macbook.and.iphone"
    }
  }
}

enum HistoryWords {
  static func sourceSymbol(_ source: HistorySource, synced: SyncedOrigin) -> String {
    switch source {
    case .thisDevice: ThisDevice.current.symbol
    case .synced: synced.symbol
    }
  }

  static func sourceName(_ source: HistorySource, synced: SyncedOrigin) -> String {
    switch source {
    case .thisDevice: ThisDevice.current.title
    case .synced: synced.name
    }
  }

  static func scopeTitle(_ scope: HistoryScope, synced: SyncedOrigin) -> String {
    switch scope {
    case .all: String(localized: "All Devices")
    case .thisDevice: sourceName(.thisDevice, synced: synced)
    case .synced: sourceName(.synced, synced: synced)
    }
  }

  static func clearMessage(everySpace: Bool, synced: Bool) -> String {
    switch (everySpace, synced) {
    case (true, _): String(localized: "This clears history from every space on this \(ThisDevice.current.noun). Your other devices keep theirs.")
    case (false, true): String(localized: "This clears history on this \(ThisDevice.current.noun). Your other devices keep theirs.")
    case (false, false): String(localized: "This can’t be undone.")
    }
  }

  static func scopeSymbol(_ scope: HistoryScope, synced: SyncedOrigin) -> String {
    switch scope {
    case .all: "rectangle.stack"
    case .thisDevice: sourceSymbol(.thisDevice, synced: synced)
    case .synced: sourceSymbol(.synced, synced: synced)
    }
  }
}

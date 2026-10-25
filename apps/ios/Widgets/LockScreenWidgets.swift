import ArdiaDesign
import SwiftUI
import WidgetKit

nonisolated struct LockScreenEntry: TimelineEntry {
  var date: Date
  var offersBrowseForMe: Bool
}

nonisolated struct LockScreenProvider: TimelineProvider {
  func placeholder(in context: Context) -> LockScreenEntry {
    LockScreenEntry(date: .now, offersBrowseForMe: false)
  }

  func getSnapshot(in context: Context, completion: @escaping (LockScreenEntry) -> Void) {
    completion(entry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LockScreenEntry>) -> Void) {
    completion(Timeline(entries: [entry()], policy: .never))
  }

  private func entry() -> LockScreenEntry {
    LockScreenEntry(date: .now, offersBrowseForMe: SystemStore.shared?.loadSnapshot().isBrowseForMeAvailable ?? false)
  }
}

struct SearchLockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SearchLockScreen", provider: LockScreenProvider()) { _ in
      SearchLockScreenFamilies()
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Search")
    .description("Quickly start searching.")
    .supportedFamilies([.accessoryCircular, .accessoryInline])
  }
}

struct SearchLockScreenFamilies: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    if family == .accessoryInline {
      SearchLockScreenInline()
    } else {
      SearchLockScreenCircular(isVoice: false)
    }
  }
}

struct SearchLockScreenRectangularWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SearchLockScreenRectangular", provider: LockScreenProvider()) { entry in
      SearchLockScreenRectangular(offersBrowseForMe: entry.offersBrowseForMe)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Search or Browse for Me")
    .description("Search the web from your Lock Screen.")
    .supportedFamilies([.accessoryRectangular])
  }
}

struct VoiceSearchLockScreenWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "VoiceSearchLockScreen", provider: LockScreenProvider()) { _ in
      SearchLockScreenCircular(isVoice: true)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("Voice Search")
    .description("Say what you’re looking for.")
    .supportedFamilies([.accessoryCircular])
  }
}

#Preview("Circular", as: .accessoryCircular) {
  SearchLockScreenWidget()
} timeline: {
  LockScreenEntry(date: .now, offersBrowseForMe: true)
}

#Preview("Rectangular", as: .accessoryRectangular) {
  SearchLockScreenRectangularWidget()
} timeline: {
  LockScreenEntry(date: .now, offersBrowseForMe: true)
}

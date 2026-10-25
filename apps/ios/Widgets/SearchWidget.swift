import AppIntents
import ArdiaDesign
import SwiftUI
import WidgetKit

struct SearchWidgetConfiguration: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "Search Widget Settings"
  static let description = IntentDescription("Customize the appearance.")

  @Parameter(title: "Show Background", default: true)
  var showBackground: Bool
}

nonisolated struct SearchEntry: TimelineEntry {
  var date: Date
  var showsBackground: Bool
  var offersBrowseForMe: Bool
  var gradient: [String]
}

nonisolated struct SearchProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> SearchEntry {
    SearchEntry(date: .now, showsBackground: true, offersBrowseForMe: false, gradient: [])
  }

  func snapshot(for configuration: SearchWidgetConfiguration, in context: Context) async -> SearchEntry {
    entry(for: configuration)
  }

  func timeline(for configuration: SearchWidgetConfiguration, in context: Context) async -> Timeline<SearchEntry> {
    Timeline(entries: [entry(for: configuration)], policy: .never)
  }

  private func entry(for configuration: SearchWidgetConfiguration) -> SearchEntry {
    let snapshot = SystemStore.shared?.loadSnapshot() ?? .empty
    return SearchEntry(
      date: .now,
      showsBackground: configuration.showBackground,
      offersBrowseForMe: snapshot.isBrowseForMeAvailable,
      gradient: snapshot.gradient
    )
  }
}

struct SearchWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "Search", intent: SearchWidgetConfiguration.self, provider: SearchProvider()) { entry in
      SearchWidgetView(entry: entry)
    }
    .configurationDisplayName("Search")
    .description("Quickly start searching.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct SearchWidgetView: View {
  let entry: SearchEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    SearchWidgetContent(
      size: family == .systemSmall ? .small : .medium,
      showsBackground: entry.showsBackground,
      offersBrowseForMe: entry.offersBrowseForMe
    )
    .widgetURL(SystemLink.search(query: nil, browseForMe: false).url)
    .containerBackground(for: .widget) {
      SearchWidgetBackground(showsBackground: entry.showsBackground, colors: colors)
    }
  }

  private var colors: [Color] {
    let parsed = entry.gradient.compactMap(Color.init(hexString:))
    return parsed.count >= 2 ? parsed : Palette.launchGradient
  }
}

#Preview("Small", as: .systemSmall) {
  SearchWidget()
} timeline: {
  SearchEntry(date: .now, showsBackground: true, offersBrowseForMe: true, gradient: [])
  SearchEntry(date: .now, showsBackground: false, offersBrowseForMe: true, gradient: [])
}

#Preview("Medium", as: .systemMedium) {
  SearchWidget()
} timeline: {
  SearchEntry(date: .now, showsBackground: true, offersBrowseForMe: true, gradient: [])
  SearchEntry(date: .now, showsBackground: true, offersBrowseForMe: false, gradient: [])
  SearchEntry(date: .now, showsBackground: false, offersBrowseForMe: true, gradient: [])
}

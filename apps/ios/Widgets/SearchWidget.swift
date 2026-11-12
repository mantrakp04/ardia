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
  var look: ProfileLook
}

nonisolated struct SearchProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> SearchEntry {
    SearchEntry(date: .now, showsBackground: true, look: .plum)
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
      look: snapshot.look
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
      showsBackground: entry.showsBackground
    )
    .environment(\.profileLook, entry.look)
    .widgetURL(SystemLink.search(query: nil).url)
    .containerBackground(for: .widget) {
      SearchWidgetBackground(showsBackground: entry.showsBackground, look: entry.look)
    }
  }
}

#Preview("Small", as: .systemSmall) {
  SearchWidget()
} timeline: {
  SearchEntry(date: .now, showsBackground: true, look: .plum)
  SearchEntry(date: .now, showsBackground: false, look: .plum)
}

#Preview("Medium", as: .systemMedium) {
  SearchWidget()
} timeline: {
  SearchEntry(date: .now, showsBackground: true, look: .plum)
  SearchEntry(date: .now, showsBackground: false, look: .plum)
}

import ArdiaDesign
import SwiftUI
import WidgetKit

nonisolated struct MacTabsEntry: TimelineEntry {
  var date: Date
  var snapshot: SystemSnapshot
}

nonisolated struct MacTabsProvider: TimelineProvider {
  func placeholder(in context: Context) -> MacTabsEntry {
    MacTabsEntry(date: .now, snapshot: .preview)
  }

  func getSnapshot(in context: Context, completion: @escaping (MacTabsEntry) -> Void) {
    let stored = SystemStore.shared?.loadSnapshot() ?? .empty
    let useSample = context.isPreview && stored.macTabs.allSatisfy(\.tabs.isEmpty)
    completion(MacTabsEntry(date: .now, snapshot: useSample ? .preview : stored))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MacTabsEntry>) -> Void) {
    let entry = MacTabsEntry(date: .now, snapshot: SystemStore.shared?.loadSnapshot() ?? .empty)
    completion(Timeline(entries: [entry], policy: .never))
  }
}

struct MacTabsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MacTabs", provider: MacTabsProvider()) { entry in
      MacTabsWidgetView(entry: entry)
    }
    .configurationDisplayName("Your Mac’s Tabs")
    .description("The tabs you have open in Ardia on your Mac.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}

struct MacTabsWidgetView: View {
  let entry: MacTabsEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    MacTabsWidgetContent(snapshot: entry.snapshot, size: family == .systemLarge ? .large : .medium, store: SystemStore.shared)
      .containerBackground(for: .widget) {
        LaunchGradient(softened: true)
      }
  }
}

#Preview("Medium", as: .systemMedium) {
  MacTabsWidget()
} timeline: {
  MacTabsEntry(date: .now, snapshot: .preview)
  MacTabsEntry(date: .now, snapshot: .empty)
}

#Preview("Large", as: .systemLarge) {
  MacTabsWidget()
} timeline: {
  MacTabsEntry(date: .now, snapshot: .preview)
}

import SwiftUI
import WidgetKit

@main
struct ArdiaWidgets: WidgetBundle {
  var body: some Widget {
    SearchWidget()
  }
}

struct SearchWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "search", provider: SearchProvider()) { _ in
      Text("Search")
    }
    .configurationDisplayName("Search")
  }
}

struct SearchProvider: TimelineProvider {
  func placeholder(in context: Context) -> SearchEntry { SearchEntry(date: .now) }
  func getSnapshot(in context: Context, completion: @escaping (SearchEntry) -> Void) { completion(SearchEntry(date: .now)) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<SearchEntry>) -> Void) {
    completion(Timeline(entries: [SearchEntry(date: .now)], policy: .never))
  }
}

struct SearchEntry: TimelineEntry {
  let date: Date
}

import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct LibraryView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var section: LibrarySection

  init(section: LibrarySection) {
    _section = State(initialValue: section)
  }

  var body: some View {
    NavigationStack {
      Group {
        switch section {
        case .history: HistoryListView(context: app.tabs.context)
        case .bookmarks: BookmarksListView()
        case .downloads: DownloadsListView()
        }
      }
      .lookBackdrop()
      .navigationTitle(section.title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) { sectionPicker }
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
    .presentationSizing(.page)
    .sensoryFeedback(.selection, trigger: section)
  }

  private var sectionPicker: some View {
    Picker("Library", selection: $section) {
      ForEach(LibrarySection.allCases) { section in
        Image(systemName: section.symbol)
          .accessibilityLabel(section.title)
          .tag(section)
      }
    }
    .pickerStyle(.segmented)
    .fixedSize()
  }
}

#Preview {
  Color.clear
    .sheet(isPresented: .constant(true)) { LibraryView(section: .history) }
    .environment(AppModel(isDemo: true))
}

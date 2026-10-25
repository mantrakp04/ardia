import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct FilterListDetailPage: View {
  let listID: String

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var isConfirmingRemoval = false

  var body: some View {
    let source = app.filterLists
    Form {
      if let list = source.list(listID) {
        Section {
          Toggle("Use This List", isOn: Binding(get: { list.isEnabled }, set: { source.setEnabled(list.id, $0) }))
        } footer: {
          if list.isDefault {
            Text("uBlock Origin turns this list on by default.")
          }
        }

        if case .failed(let message) = list.state {
          Section {
            Label {
              Text(message)
            } icon: {
              Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.ink(.orange))
            }
            Button("Try Again") { Task { await source.updateNow() } }
              .disabled(source.isUpdating)
          }
        }

        Section {
          LabeledContent("Status", value: FilterListDetailWords.status(list))
          LabeledContent("Last Updated", value: list.updatedAt?.formatted(date: .abbreviated, time: .shortened) ?? String(localized: "Never"))
          LabeledContent("Rules", value: list.ruleCount.formatted())
          LabeledContent("Skipped", value: list.skippedCount.formatted())
        } footer: {
          if list.skippedCount > 0 {
            Text("Skipped rules use features Safari’s content blocker can’t run, like scriptlets. The rest of the list still works.")
          }
        }

        if let url = list.sourceURL {
          Section {
            Link(destination: url) {
              Text(verbatim: url.absoluteString)
                .lineLimit(2)
                .truncationMode(.middle)
                .font(.subheadline)
            }
            if let support = list.supportURL {
              Link("Visit the List’s Website", destination: support)
            }
          } header: {
            Text("Source")
          }
        }

        if list.isCustom {
          Section {
            Button("Remove List…", role: .destructive) { isConfirmingRemoval = true }
          }
        }
      } else {
        ContentUnavailableView("List Removed", systemImage: "list.bullet.rectangle")
      }
    }
    .navigationTitle(source.list(listID)?.title ?? String(localized: "Filter List"))
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog("Remove This List?", isPresented: $isConfirmingRemoval, titleVisibility: .visible) {
      Button("Remove List", role: .destructive) {
        source.removeList(listID)
        dismiss()
      }
    } message: {
      Text("Ardia stops using its rules. You can add it again with its address.")
    }
  }
}

enum FilterListDetailWords {
  static func status(_ list: FilterListInfo) -> String {
    switch list.state {
    case .downloading: String(localized: "Downloading…")
    case .compiling: String(localized: "Compiling…")
    case .failed: String(localized: "Couldn’t Update")
    case .offline: String(localized: "Offline")
    case .ready: list.isEnabled ? String(localized: "On") : String(localized: "Off")
    }
  }
}

#Preview("Filter List Detail") {
  NavigationStack {
    FilterListDetailPage(listID: "easylist")
  }
  .environment(AppModel(isDemo: true))
}

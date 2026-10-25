import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct FilterListsPage: View {
  @Environment(AppModel.self) private var app
  @State private var detailID: String?
  @State private var isAdding = false
  @State private var isConfirmingReset = false
  @State private var updates = 0
  @State private var updateFailures = 0

  var body: some View {
    let source = app.filterLists
    Form {
      SettingsHero(
        "Filter Lists",
        subtitle: Text(FilterListWords.summary(lists: source.enabledLists.count, rules: source.enabledRuleCount)),
        systemImage: "shield.lefthalf.filled",
        tint: SettingsTint.ads
      ) {
        Text(FilterListWords.status(isUpdating: source.isUpdating, isOffline: source.isOffline, lastUpdated: source.lastUpdated))
          .font(.footnote)
          .foregroundStyle(source.isOffline ? AnyShapeStyle(.ink(.orange)) : AnyShapeStyle(.secondary))
          .contentTransition(.opacity)
      }

      Section {
        Button {
          Task {
            await source.updateNow()
            if source.isOffline || source.enabledLists.contains(where: { if case .failed = $0.state { true } else { false } }) {
              updateFailures += 1
            } else {
              updates += 1
            }
          }
        } label: {
          HStack {
            Text(source.isUpdating ? "Updating Lists…" : "Update Now")
            Spacer()
            if source.isUpdating { ProgressView() }
          }
        }
        .disabled(source.isUpdating)
      } footer: {
        Text("Ardia checks for new versions once a week, and when you turn a list on.")
      }

      ForEach(FilterListGroup.allCases) { group in
        let lists = source.lists.filter { $0.group == group }
        if !lists.isEmpty {
          Section {
            ForEach(lists) { list in
              FilterListRow(list: list, source: source) { detailID = list.id }
            }
          } header: {
            Text(group.title)
          } footer: {
            if group == .builtIn {
              Text("Lists that ship turned on match uBlock Origin’s defaults.")
            }
          }
        }
      }

      Section {
        Button("Add a List…") { isAdding = true }
        NavigationLink(value: SettingsRoute.myFilters) {
          LabeledContent("My Filters") {
            Text(source.myFiltersResult.ruleCount == 0 ? String(localized: "None") : FilterListWords.rules(source.myFiltersResult.ruleCount))
          }
        }
      } footer: {
        Text("Add any list in Adblock Plus or uBlock Origin format, or write your own rules.")
      }

      Section {
        Button("Restore Defaults…", role: .destructive) { isConfirmingReset = true }
      } footer: {
        Text("Turns uBlock Origin’s default lists back on and the rest off. My Filters stays as it is.")
      }
    }
    .settingsPage("Filter Lists")
    .refreshable { await source.updateNow() }
    .navigationDestination(item: $detailID) { id in
      FilterListDetailPage(listID: id)
    }
    .sheet(isPresented: $isAdding) {
      AddFilterListSheet()
    }
    .confirmationDialog(FilterListReset.title, isPresented: $isConfirmingReset, titleVisibility: .visible) {
      Button("Restore Defaults", role: .destructive) {
        Task { await source.resetToDefaults() }
      }
    } message: {
      Text(FilterListReset.message(customLists: source.customListCount))
    }
    .sensoryFeedback(.success, trigger: updates)
    .sensoryFeedback(.error, trigger: updateFailures)
    #if DEBUG
    .onAppear {
      if ProcessInfo.processInfo.arguments.contains("-ArdiaFilterAdd") { isAdding = true }
    }
    #endif
  }
}

private struct FilterListRow: View {
  let list: FilterListInfo
  let source: FilterLists
  var onShowDetail: () -> Void

  var body: some View {
    HStack(spacing: Spacing.small) {
      Button(action: onShowDetail) {
        VStack(alignment: .leading, spacing: 2) {
          Text(verbatim: list.title)
            .foregroundStyle(.primary)
          FilterListWords.facts(list)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .contentTransition(.opacity)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityHint(Text("Shows the list’s details"))

      if list.state == .downloading || list.state == .compiling {
        ProgressView()
          .accessibilityHidden(true)
      }

      Toggle(isOn: Binding(get: { list.isEnabled }, set: { source.setEnabled(list.id, $0) })) {
        Text(verbatim: list.title)
      }
      .labelsHidden()
    }
    .padding(.vertical, 2)
  }
}

enum FilterListReset {
  static var title: String { String(localized: "Restore Default Filter Lists?") }

  static func message(customLists: Int) -> String {
    guard customLists > 0 else {
      return String(localized: "uBlock Origin’s default lists turn back on and the rest turn off.")
    }
    let removed = String(AttributedString(localized: "^[\(customLists) list](inflect: true) you added").characters)
    return String(localized: "uBlock Origin’s default lists turn back on, the rest turn off, and \(removed) will be removed.")
  }
}

#Preview("Filter Lists") {
  NavigationStack {
    FilterListsPage()
      .navigationDestination(for: SettingsRoute.self) { $0.destination }
  }
  .environment(AppModel(isDemo: true))
}

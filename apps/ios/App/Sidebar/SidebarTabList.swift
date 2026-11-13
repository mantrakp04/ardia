import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SidebarTabList: View {
  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar

  var body: some View {
    let regular = app.spaceTabs
    let incognito = app.tabs.privateTabs
    List {
      SidebarSectionLabel(title: String(localized: "Today"))
        .sidebarListRow()
      ForEach(regular, id: \.id) { tab in
        row(tab)
      }
      .onMove { sources, destination in move(sources, to: destination, in: regular) }
      .onInsert(of: SidebarDropTypes.accepted) { index, providers in
        _ = DropLoader.load(providers) { app.open($0, at: index) }
      }
      SidebarNewTabRow()
        .sidebarListRow()
      if !incognito.isEmpty {
        SidebarSectionLabel(title: String(localized: "Incognito"))
          .sidebarListRow()
        ForEach(incognito, id: \.id) { tab in
          row(tab)
        }
        .onMove { sources, destination in move(sources, to: destination, in: incognito) }
      }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .environment(\.defaultMinListRowHeight, 0)
    .scrollIndicators(.automatic)
  }

  private func row(_ tab: BrowserTab) -> some View {
    SidebarTabRow(tab: tab, isSelected: tab.id == app.tabs.selectedTabID && app.surface != .search)
      .sidebarListRow()
      .itemProvider { SidebarTabRow.dragItem(for: tab) }
  }

  private func move(_ sources: IndexSet, to destination: Int, in tabs: [BrowserTab]) {
    guard let moved = RowReorder.move(sources, toOffset: destination), tabs.indices.contains(moved.source) else { return }
    app.moveTab(tabs[moved.source].id, toIndex: moved.index)
  }
}

private struct SidebarSectionLabel: View {
  let title: String

  var body: some View {
    Text(title)
      .font(Typography.section)
      .foregroundStyle(Tokens.Role.textSecondary)
      .lineLimit(1)
      .padding(.leading, SidebarChrome.RowParts.contentLeading)
      .padding(.top, SidebarChrome.RowParts.sectionTop)
      .padding(.bottom, SidebarChrome.RowParts.sectionBottom)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }
}

extension View {
  func sidebarListRow() -> some View {
    listRowInsets(EdgeInsets(
      top: SidebarMetrics.Row.gap / 2,
      leading: SidebarMetrics.sideInset,
      bottom: SidebarMetrics.Row.gap / 2,
      trailing: SidebarMetrics.sideInset
    ))
    .listRowBackground(Color.clear)
    .listRowSeparator(.hidden)
  }
}

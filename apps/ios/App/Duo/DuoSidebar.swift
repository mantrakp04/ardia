import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct DuoSidebar: View {
  enum Style {
    case overlay
    case panel
  }

  let style: Style
  let close: () -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var look
  @State private var page: String?
  @State private var isConfirmingCloseAll = false

  var body: some View {
    let spaces = app.spaces
    VStack(spacing: 0) {
      header
      DuoSidebarAddress(close: close)
        .padding(.horizontal, DuoLayout.sidebarPadding)
      pages(spaces)
      if spaces.count > 1 {
        SpacePageDots(count: spaces.count, index: spaces.firstIndex { $0.syncId == app.currentSpace?.syncId } ?? 0)
          .padding(.top, 8)
          .padding(.bottom, DuoLayout.sidebarDotsBottom)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background { background }
    .onAppear { page = app.currentSpace?.syncId }
    .onChange(of: app.currentSpace?.syncId) { _, id in
      if page != id { page = id }
    }
    .onChange(of: page) { _, id in
      if let id { app.switchSpace(to: id) }
    }
    .sensoryFeedback(.selection, trigger: app.currentSpace?.syncId)
    .confirmationDialog(closeAllTitle, isPresented: $isConfirmingCloseAll, titleVisibility: .visible) {
      Button(closeAllTitle, role: .destructive) { app.closeAllTabs() }
    } message: {
      Text(app.tabs.privateTabs.isEmpty ? "They’ll stay in your Archive." : "Incognito tabs aren’t saved. Other tabs stay in your Archive.")
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(style == .overlay ? Text("Sidebar") : Text("Tabs"))
  }

  @ViewBuilder
  private var background: some View {
    if style == .overlay {
      let shape = RoundedRectangle(cornerRadius: DuoLayout.sidebarRadius, style: .continuous)
      shape
        .fill(app.isIncognito ? BrowsePalette.incognitoSheet : look.surface)
        .shadow(color: .black.opacity(0.18), radius: 18, y: 4)
    }
  }

  private var closeAllTitle: String {
    let count = app.deckTabs.count
    return count == 1 ? String(localized: "Close 1 Tab?") : String(localized: "Close \(count) Tabs?")
  }

  private var header: some View {
    HStack(spacing: 4) {
      SpaceSwitcher(spaces: app.spaces, current: app.currentSpace) { app.switchSpace(to: $0) }
      Spacer(minLength: 4)
      DuoMoreMenu(hasTabs: !app.deckTabs.isEmpty, closeAll: { isConfirmingCloseAll = true })
      if style == .overlay {
        Button(action: close) {
          Image(systemName: "sidebar.left")
            .font(.system(size: 17, weight: .regular))
            .foregroundStyle(BrowsePalette.foregroundPrimary)
            .frame(width: BrowseLayout.hitTarget, height: BrowseLayout.hitTarget)
            .contentShape(.rect)
        }
        .buttonStyle(BarButtonStyle())
        .accessibilityLabel("Hide Sidebar")
      }
    }
    .padding(.leading, DuoLayout.sidebarPadding + 14)
    .padding(.trailing, DuoLayout.sidebarPadding)
    .frame(height: DuoLayout.sidebarHeaderHeight)
    .padding(.top, style == .overlay ? DuoLayout.sidebarHeaderTop : DuoLayout.panelTop)
  }

  @ViewBuilder
  private func pages(_ spaces: [SyncedProfile]) -> some View {
    if spaces.count > 1 {
      TabView(selection: $page) {
        ForEach(spaces) { space in
          DuoSpaceList(space: space, showsTiles: style == .overlay, close: close)
            .tag(Optional(space.syncId))
        }
      }
      .tabViewStyle(.page(indexDisplayMode: .never))
    } else {
      DuoSpaceList(space: spaces.first, showsTiles: style == .overlay, close: close)
    }
  }
}

struct DuoSidebarAddress: View {
  let close: () -> Void

  @Environment(AppModel.self) private var app

  var body: some View {
    let address = BarAddress(tab: app.tabs.selectedTab, page: app.currentPage)
    Button(action: edit) {
      DuoHostLabel(address: address)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: DuoLayout.sidebarFieldHeight)
        .contentShape(.capsule)
    }
    .buttonStyle(BarButtonStyle())
    .chromeSurface(in: .capsule)
    .accessibilityLabel(address.isInsecure ? Text("Address, Not Secure") : Text("Address"))
    .accessibilityValue(Text(address.host))
    .accessibilityHint("Opens search with this page’s address.")
  }

  private func edit() {
    close()
    guard let tab = app.tabs.selectedTab else {
      app.newTab()
      return
    }
    app.browse.presentSearch(from: .page, text: app.currentQuery(for: tab), selectsAll: true)
  }
}

struct DuoSpaceList: View {
  let space: SyncedProfile?
  let showsTiles: Bool
  let close: () -> Void

  @Environment(AppModel.self) private var app

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        if showsTiles, let tiles = space?.pinned.tiles, !tiles.isEmpty {
          PinnedTiles(tiles: tiles, perRow: 2) { url, title in
            close()
            app.openPinned(url: url, title: title)
          }
          .padding(.top, DuoLayout.sidebarPadding)
        }
        Text("Today")
          .font(.subheadline.weight(.medium))
          .foregroundStyle(.secondary)
          .padding(.leading, DuoLayout.sidebarRowLead + 6)
          .padding(.top, DuoLayout.sidebarSectionTop + 6)
          .padding(.bottom, 4)
          .accessibilityAddTraits(.isHeader)
        ForEach(tabs) { tab in
          DuoTabRow(tab: tab, isSelected: tab.id == app.tabs.selectedTabID, open: {
            close()
            app.openTab(tab.id)
          }, closeTab: { app.closeTab(tab.id) })
        }
        Button {
          close()
          app.newTab()
        } label: {
          HStack(spacing: 12) {
            Image(systemName: "plus")
              .font(.system(size: 16, weight: .regular))
              .frame(width: DuoLayout.sidebarRowIcon)
            Text("New Tab")
            Spacer(minLength: 0)
          }
          .foregroundStyle(.secondary)
          .padding(.leading, DuoLayout.sidebarRowLead)
          .frame(height: DuoLayout.sidebarRowPitch)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, DuoLayout.sidebarPadding)
      .padding(.bottom, DuoLayout.sidebarPadding)
    }
    .scrollIndicators(.hidden)
  }

  private var tabs: [BrowserTab] {
    if space?.syncId == app.currentSpace?.syncId { return app.deckOrder }
    return AppModel.recencyOrder(app.tabs.openTabs(inSpace: space?.syncId), selected: nil)
  }
}

struct DuoTabRow: View {
  let tab: BrowserTab
  let isSelected: Bool
  let open: () -> Void
  let closeTab: () -> Void

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: DuoLayout.sidebarRowRadius, style: .continuous)
    HStack(spacing: 0) {
      Button(action: open) {
        HStack(spacing: 12) {
          icon
            .frame(width: DuoLayout.sidebarRowIcon)
          Text(TabText.title(for: tab))
            .foregroundStyle(BrowsePalette.foregroundPrimary)
            .lineLimit(1)
          Spacer(minLength: 0)
        }
        .padding(.leading, DuoLayout.sidebarRowLead)
        .frame(height: DuoLayout.sidebarRowHeight)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(TabText.title(for: tab))
      .accessibilityValue(tab.isPrivate ? String(localized: "Incognito, \(TabText.host(for: tab))") : TabText.host(for: tab))
      .accessibilityAddTraits(isSelected ? .isSelected : [])
      if isSelected {
        Button(action: closeTab) {
          Image(systemName: "xmark")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(width: BrowseLayout.hitTarget, height: DuoLayout.sidebarRowHeight)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close Tab")
      }
    }
    .background {
      if isSelected { Color.clear.chromeSurface(in: shape, interactive: false) }
    }
    .frame(height: DuoLayout.sidebarRowPitch)
    .contextMenu {
      Button("Close Tab", role: .destructive, action: closeTab)
    }
  }

  @ViewBuilder
  private var icon: some View {
    if tab.isPrivate {
      Image(systemName: "eyeglasses")
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)
    } else {
      FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: DuoLayout.sidebarRowIcon)
    }
  }
}

struct DuoMoreMenu: View {
  let hasTabs: Bool
  let closeAll: () -> Void
  var diameter: CGFloat?

  @Environment(AppModel.self) private var app

  var body: some View {
    Menu {
      Section {
        Button("Archive") { app.openArchive() }
        if app.sync.isEnabled {
          Button("Spaces From Your Mac") { app.openSyncedSpaces() }
        }
      }
      Section {
        Button("New Incognito Tab") { app.newIncognitoTab() }
        if app.tabs.canReopenClosed {
          Button("Reopen Closed Tab") { app.reopenLastClosed() }
        }
        if hasTabs {
          Button("Close All Tabs", role: .destructive, action: closeAll)
        }
      }
      Button("Settings") { app.sheet = .settings }
    } label: {
      if let diameter {
        GlassCircleFace(symbol: "ellipsis", diameter: diameter)
      } else {
        Image(systemName: "ellipsis")
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(BrowsePalette.foregroundPrimary)
          .frame(width: BrowseLayout.hitTarget, height: BrowseLayout.hitTarget)
          .contentShape(.rect)
      }
    }
    .menuOrder(.fixed)
    .buttonStyle(.plain)
    .accessibilityLabel("More")
  }
}

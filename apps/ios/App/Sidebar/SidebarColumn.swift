import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UniformTypeIdentifiers

struct SidebarColumn: View {
  let width: CGFloat
  let edge: HorizontalEdge
  let showsPinned: Bool
  let showsToggle: Bool

  @Environment(AppModel.self) private var app
  @State private var isDropTargeted = false

  var body: some View {
    let inner = max(width - SidebarMetrics.sideInset * 2, 0)
    VStack(spacing: 0) {
      SidebarHeader(edge: edge, showsToggle: showsToggle)
        .frame(height: SidebarMetrics.headerHeight)
      SidebarAddressField()
      if showsPinned {
        PinnedTileGrid(width: inner)
          .padding(.top, SidebarMetrics.Tile.gap)
      }
      SidebarTabList()
        .padding(.horizontal, -SidebarMetrics.sideInset)
      if app.spaces.count > 1 {
        SpaceDots()
          .frame(maxWidth: .infinity)
          .frame(height: SidebarMetrics.footerHeight)
      } else {
        Color.clear.frame(height: SidebarMetrics.sideInset)
      }
    }
    .padding(.horizontal, SidebarMetrics.sideInset)
    .background {
      if isDropTargeted {
        RoundedRectangle(cornerRadius: SidebarMetrics.Row.radius, style: .continuous)
          .fill(Tokens.Role.tabHover)
          .padding(SidebarMetrics.sideInset / 2)
      }
    }
    .lookInk()
    .onDrop(of: SidebarDropTypes.accepted, isTargeted: $isDropTargeted) { providers in
      DropLoader.load(providers) { app.open($0) }
    }
  }
}

private struct SidebarHeader: View {
  let edge: HorizontalEdge
  let showsToggle: Bool

  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar
  @Environment(\.chromeLayout) private var layout
  @Environment(\.hingeState) private var hinge

  var body: some View {
    HStack(spacing: Tokens.Space.xs) {
      if showsToggle, edge == .trailing { toggle }
      if app.currentSpace != nil {
        SpaceHeader()
      } else {
        Text(String(localized: "Ardia"))
          .typography(.title)
          .foregroundStyle(Tokens.Role.textPrimary)
      }
      Spacer(minLength: 0)
      menu
      if showsToggle, edge == .leading { toggle }
    }
    .padding(.horizontal, SidebarChrome.RowParts.trailing)
  }

  private var menu: some View {
    Menu {
      ForEach(LibrarySection.allCases) { section in
        Button(section.title, systemImage: section.symbol) {
          sidebar.dismissOverlay()
          app.openLibrary(section)
        }
      }
      Button(String(localized: "Archive"), systemImage: "archivebox") {
        sidebar.dismissOverlay()
        app.openArchive()
      }
      Divider()
      Button(String(localized: "Settings"), systemImage: "gearshape") {
        sidebar.dismissOverlay()
        app.sheet = .settings
      }
    } label: {
      headerGlyph("ellipsis")
    }
    .menuOrder(.fixed)
    .accessibilityLabel(String(localized: "More"))
  }

  private var toggle: some View {
    Button {
      sidebar.toggle(layout: layout, hinge: hinge)
    } label: {
      headerGlyph(edge == .leading ? "sidebar.leading" : "sidebar.trailing")
    }
    .accessibilityLabel((sidebar.toggleAction(layout: layout, hinge: hinge) ?? .hide).title)
  }

  private func headerGlyph(_ symbol: String) -> some View {
    Image(systemName: symbol)
      .font(Typography.body.weight(Tokens.Weight.medium))
      .foregroundStyle(Tokens.Role.icon)
      .frame(width: GlassMetrics.hitTarget, height: GlassMetrics.hitTarget)
      .contentShape(.rect)
      .hoverEffect(.highlight)
  }
}

enum SidebarDropTypes {
  static let accepted: [UTType] = [.url, .plainText]
}

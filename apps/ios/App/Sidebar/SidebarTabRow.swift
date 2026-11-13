import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SidebarTabRow: View {
  let tab: BrowserTab
  let isSelected: Bool

  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar
  @State private var isHovering = false

  var body: some View {
    let showsClose = isSelected || isHovered
    ZStack(alignment: .trailing) {
      Button(action: open) {
        HStack(spacing: SidebarChrome.RowParts.titleGap) {
          FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: SidebarMetrics.Row.icon)
          FadingTitle(text: title)
            .foregroundStyle(isSelected ? Tokens.Role.tabSelectedText : Tokens.Role.textTab)
          if showsClose {
            Color.clear.frame(width: SidebarChrome.RowParts.closeSlot)
          }
        }
        .padding(.leading, SidebarChrome.RowParts.contentLeading)
        .padding(.trailing, SidebarChrome.RowParts.trailing)
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: SidebarMetrics.Row.height, alignment: .leading)
      }
      .buttonStyle(SidebarRowStyle(isSelected: isSelected, isHovered: isHovered))
      if showsClose {
        RowCloseButton { app.closeTab(tab.id) }
          .padding(.trailing, SidebarChrome.RowParts.trailing)
      }
    }
    .onHover { isHovering = $0 }
    .contextMenu { menu }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    .accessibilityAction(named: String(localized: "Close Tab")) { app.closeTab(tab.id) }
  }

  private var isHovered: Bool {
    isHovering || sidebar.demoHoveredTab == tab.id
  }

  private var title: String {
    if !tab.title.isEmpty { return tab.title }
    return BrowserURL.isSyncable(tab.url) ? SearchInput.displayHost(tab.url) : String(localized: "New Tab")
  }

  private func open() {
    sidebar.dismissOverlay()
    app.openTab(tab.id)
  }

  @ViewBuilder
  private var menu: some View {
    if let url = URL(string: tab.url), BrowserURL.isSyncable(tab.url) {
      Button(String(localized: "Copy Link"), systemImage: "link") { app.copyLink(of: tab) }
      ShareLink(item: url) { Label(String(localized: "Share"), systemImage: "square.and.arrow.up") }
    }
    let spaces = app.spacesToMove(tab)
    if !spaces.isEmpty {
      Menu(String(localized: "Move to Space"), systemImage: "arrow.right.square") {
        ForEach(spaces) { space in
          Button(space.name) { app.moveTab(tab.id, toSpace: space.syncId) }
        }
      }
    }
    if app.sync.isEnabled, !tab.isPrivate, BrowserURL.isSyncable(tab.url) {
      Button(String(localized: "Pin to Mac"), systemImage: "pin") { app.pinToMac(tab) }
    }
    Divider()
    Button(String(localized: "Close Tab"), systemImage: "xmark", role: .destructive) { app.closeTab(tab.id) }
  }

  static func dragItem(for tab: BrowserTab) -> NSItemProvider? {
    guard let url = SidebarDrop.exportedLink(url: tab.url, isPrivate: tab.isPrivate) else { return nil }
    let provider = NSItemProvider(object: url as NSURL)
    provider.suggestedName = tab.title.isEmpty ? nil : tab.title
    provider.registerDataRepresentation(forTypeIdentifier: SidebarDrop.ownRowType, visibility: .ownProcess) { load in
      load(Data(), nil)
      return nil
    }
    return provider
  }
}

struct SidebarRowStyle: ButtonStyle {
  let isSelected: Bool
  let isHovered: Bool

  @Environment(\.profileLook) private var look
  @Environment(\.colorScheme) private var colorScheme
  @Environment(AppModel.self) private var app

  func makeBody(configuration: Configuration) -> some View {
    let shape = RoundedRectangle(cornerRadius: SidebarMetrics.Row.radius, style: .continuous)
    configuration.label
      .background {
        if isSelected {
          shape
            .fill(selectedFill)
            .shadow(color: glowColor, radius: Tokens.RoleValue.tabSelectedShadowRadius.resolved(dark: isDark), y: SidebarChrome.RowParts.glowOffset)
            .overlay {
              shape.strokeBorder(
                LinearGradient(colors: [Tokens.Role.tabSelectedBorderTop.color, Tokens.Role.tabSelectedBorderBottom.color], startPoint: .top, endPoint: .bottom),
                lineWidth: SidebarChrome.RowParts.selectedBorder
              )
            }
        } else if configuration.isPressed {
          shape.fill(Tokens.Role.tabPressed)
        } else if isHovered {
          shape.fill(Tokens.Role.tabHover)
        }
      }
      .contentShape(shape)
      .animation(.easeOut(duration: Tokens.Duration.fast), value: isHovered)
  }

  private var isDark: Bool { colorScheme == .dark }

  private var selectedFill: SchemeColor {
    look.showsTheme(dark: isDark, themed: true) ? Tokens.Role.arcSelectedFill : Tokens.Role.tabSelected
  }

  private var glowColor: Color {
    let base = Tokens.Role.tabSelectedShadow.resolved(dark: isDark)
    switch app.sync.snapshot.lookSettings?.selectedTabGlow {
    case .off: return .clear
    case .soft: return base.withOpacity(base.opacity * SidebarChrome.RowParts.softGlowShare).color
    case .full, nil: return base.color
    }
  }
}

private struct RowCloseButton: View {
  let action: () -> Void
  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: "xmark")
        .font(Typography.badge.weight(Tokens.Weight.bold))
        .foregroundStyle(Tokens.Role.textSecondary)
        .frame(width: SidebarChrome.RowParts.closeSlot, height: SidebarChrome.RowParts.closeSlot)
        .background {
          if isHovering {
            RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous).fill(Tokens.Role.tabHover)
          }
        }
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
    .accessibilityLabel(String(localized: "Close Tab"))
  }
}

struct FadingTitle: View {
  let text: String
  @State private var naturalWidth: CGFloat = 0
  @State private var shownWidth: CGFloat = 0

  var body: some View {
    Text(text)
      .font(Typography.row)
      .lineLimit(1)
      .fixedSize(horizontal: true, vertical: false)
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { naturalWidth = $0 }
      .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { shownWidth = $0 }
      .clipped()
      .mask { fade }
  }

  @ViewBuilder
  private var fade: some View {
    if naturalWidth > shownWidth.rounded(.up), shownWidth > SidebarChrome.RowParts.titleFade {
      LinearGradient(
        stops: [
          .init(color: .black, location: 0),
          .init(color: .black, location: 1 - SidebarChrome.RowParts.titleFade / shownWidth),
          .init(color: .clear, location: 1),
        ],
        startPoint: .leading,
        endPoint: .trailing
      )
    } else {
      Rectangle()
    }
  }
}

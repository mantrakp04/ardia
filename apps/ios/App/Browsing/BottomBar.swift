import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct BottomBar: View {
  let isSearchPresented: Bool
  var sideInset: CGFloat = 0
  var onTabs: () -> Void
  var onPlus: () -> Void
  var onMore: () -> Void
  var onStep: (Int) -> Void = { _ in }
  var onSelectTab: (UUID) -> Void = { _ in }
  var onCloseTab: () -> Void = {}

  @Environment(AppModel.self) private var app

  var body: some View {
    let order = app.deckOrder
    HStack(spacing: 0) {
      Button(action: onTabs) {
        TabStackGlyph(tabs: Array(order.suffix(2)))
          .frame(width: BrowseLayout.hitTarget, height: BrowseLayout.hitTarget)
          .contentShape(.circle)
      }
      .buttonStyle(BarButtonStyle())
      .contextMenu { recentTabsMenu(order) }
      .accessibilityLabel("Tabs")
      .accessibilityValue(Text("^[\(order.count) tab](inflect: true)"))
      .accessibilityHint("Touch and hold for recent tabs.")
      .accessibilityActions {
        Button("Previous Tab") { onStep(-1) }
        Button("Next Tab") { onStep(1) }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      ZStack {
        if !isSearchPresented {
          Button(action: onPlus) {
            Image(systemName: "plus")
              .font(.system(size: 18, weight: .semibold))
              .foregroundStyle(BrowsePalette.foregroundPrimary)
              .frame(width: BrowseLayout.plusCapsule.width, height: BrowseLayout.plusCapsule.height)
              .background(BrowsePalette.fieldFill, in: .capsule)
              .contentShape(.capsule)
          }
          .buttonStyle(BarButtonStyle())
          .transition(.opacity)
          .accessibilityLabel("New Search")
        }
      }
      .frame(width: BrowseLayout.plusCapsule.width, height: BrowseLayout.plusCapsule.height)

      Button(action: onMore) {
        Image(systemName: "chevron.up")
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(BrowsePalette.foregroundPrimary)
          .frame(width: BrowseLayout.hitTarget, height: BrowseLayout.hitTarget)
          .contentShape(.circle)
      }
      .buttonStyle(BarButtonStyle())
      .accessibilityLabel("Page Menu")
      .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding(BrowseLayout.barPillPadding)
    .frame(height: BrowseLayout.barPillHeight)
    .glassEffect(.regular.interactive(), in: .capsule)
    .contentShape(.capsule)
    .padding(.horizontal, sideInset + BrowseLayout.barSideInset)
  }

  @ViewBuilder
  private func recentTabsMenu(_ order: [BrowserTab]) -> some View {
    let recent = order.dropLast().suffix(8).reversed()
    ForEach(Array(recent)) { tab in
      Button(TabText.title(for: tab)) { onSelectTab(tab.id) }
    }
    if !recent.isEmpty { Divider() }
    Button("Close Tab", systemImage: "xmark", role: .destructive, action: onCloseTab)
  }
}

enum BarPalette {
  static let tileFill = Color.adaptive(light: Color(hex: 0x767680, opacity: 0.2), dark: Color.white.opacity(0.2))
  static let tileEdge = Color.adaptive(light: Color.black.opacity(0.14), dark: Color.white.opacity(0.28))
}

struct BarButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .sensoryFeedback(.impact(weight: .light, intensity: 0.5), trigger: configuration.isPressed) { _, pressed in pressed }
  }
}

struct TabStackGlyph: View {
  let tabs: [BrowserTab]

  var body: some View {
    ZStack {
      switch tabs.count {
      case 0:
        RoundedRectangle(cornerRadius: BrowseLayout.tabStackRadius, style: .continuous)
          .strokeBorder(BrowsePalette.foregroundSecondary, lineWidth: 1.5)
          .frame(width: BrowseLayout.tabStackTile.width, height: BrowseLayout.tabStackTile.height)
      case 1:
        TabThumbnail(tab: tabs[0])
          .rotationEffect(.degrees(-4))
      default:
        TabThumbnail(tab: tabs[0])
          .rotationEffect(.degrees(-12))
          .offset(x: -4, y: 1)
        TabThumbnail(tab: tabs[1])
          .rotationEffect(.degrees(6))
          .offset(x: 4, y: -1)
      }
    }
    .accessibilityHidden(true)
  }
}

struct TabThumbnail: View {
  let tab: BrowserTab

  @Environment(AppModel.self) private var app
  @State private var image: CGImage?

  private var shape: RoundedRectangle {
    RoundedRectangle(cornerRadius: BrowseLayout.tabStackRadius, style: .continuous)
  }

  var body: some View {
    let size = BrowseLayout.tabStackTile
    ZStack {
      if let memory = app.browse.covers.image(for: tab.id) ?? app.deck.memoryImage(for: tab.id) {
        Image(uiImage: memory)
          .resizable()
          .scaledToFill()
          .frame(width: size.width, height: size.height, alignment: .top)
      } else if let image {
        Image(decorative: image, scale: 1)
          .resizable()
          .scaledToFill()
          .frame(width: size.width, height: size.height, alignment: .top)
      } else {
        fallback
      }
    }
    .frame(width: size.width, height: size.height)
    .clipShape(shape)
    .overlay { shape.strokeBorder(BarPalette.tileEdge, lineWidth: 0.5) }
    .shadow(color: .black.opacity(0.2), radius: 1.5, y: 0.5)
    .task(id: tab.snapshotFileName) {
      guard let name = tab.snapshotFileName else {
        image = nil
        return
      }
      image = await app.web.snapshots.image(named: name)
    }
  }

  @ViewBuilder
  private var fallback: some View {
    if tab.isPrivate {
      TabsPalette.incognitoCard
      IncognitoGlyph(size: 12)
    } else {
      ZStack {
        if let theme = ToneColor(hex: tab.themeColorHex) { theme.color } else { BarPalette.tileFill }
        FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: 12)
      }
    }
  }
}

struct PressableStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.94 : 1)
      .animation(Motion.press, value: configuration.isPressed)
  }
}

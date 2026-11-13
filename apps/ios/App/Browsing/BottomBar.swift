import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct BottomBar: View {
  enum Arrangement {
    case row
    case column(ScreenLayout.SideColumn, CGSize)
  }

  let address: BarAddress
  let isCollapsed: Bool
  var arrangement = Arrangement.row
  var sideInset: CGFloat = 0
  let actions: BarActions

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    if case .column(let column, let size) = arrangement {
      SideColumnStack(column: column, size: size) {
        BarTabsButton(actions: actions)
        BarSiteButton(address: address, action: actions.onAddress)
        BarRoundMenuButton(action: actions.onMore)
        BarPlusButton(action: actions.onPlus)
      }
    } else {
      rowBar
    }
  }

  private var rowBar: some View {
    ZStack(alignment: .bottom) {
      if isCollapsed {
        BarCollapsedPill(address: address, action: actions.onExpand)
          .transition(.scale(scale: reduceMotion ? 1 : 1 / BrowseLayout.barCollapsedScale, anchor: .bottom).combined(with: .opacity))
      } else {
        expanded
          .transition(.scale(scale: reduceMotion ? 1 : BrowseLayout.barCollapsedScale, anchor: .bottom).combined(with: .opacity))
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, sideInset + BrowseLayout.barEdgeInset)
  }

  @ViewBuilder
  private var expanded: some View {
    switch arrangement {
    case .row:
      HStack(spacing: BrowseLayout.barGap) {
        BarTabsButton(actions: actions)
        BarAddressField(address: address, onAddress: actions.onAddress, onMore: actions.onMore)
        BarPlusButton(action: actions.onPlus)
      }
    case .column:
      EmptyView()
    }
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

import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct TabStackGlyph: View {
  let tabs: [BrowserTab]

  static let recentLimit = 8

  static func shown(order: [BrowserTab], selectedID: UUID?) -> [BrowserTab] {
    let selected = order.filter { $0.id == selectedID }
    let others = order.filter { $0.id != selectedID }
    return Array((others + selected).suffix(2))
  }

  static func recent(order: [BrowserTab], selectedID: UUID?) -> [BrowserTab] {
    Array(order.filter { $0.id != selectedID }.sorted { $0.lastActive > $1.lastActive }.prefix(recentLimit))
  }

  var body: some View {
    ZStack {
      switch tabs.count {
      case 0:
        RoundedRectangle(cornerRadius: BrowseLayout.tabStackRadius, style: .continuous)
          .strokeBorder(Tokens.Role.textSecondary, lineWidth: TabStackMetrics.emptyStroke)
          .frame(width: BrowseLayout.tabStackTile.width, height: BrowseLayout.tabStackTile.height)
      case 1:
        TabThumbnail(tab: tabs[0])
          .rotationEffect(.degrees(-TabStackMetrics.singleTilt))
      default:
        TabThumbnail(tab: tabs[0])
          .rotationEffect(.degrees(-TabStackMetrics.backTilt))
          .offset(x: -TabStackMetrics.spread, y: 1)
        TabThumbnail(tab: tabs[1])
          .rotationEffect(.degrees(TabStackMetrics.frontTilt))
          .offset(x: TabStackMetrics.spread, y: -1)
      }
    }
    .accessibilityHidden(true)
  }
}

enum TabStackMetrics {
  static let emptyStroke: CGFloat = 1.5
  static let singleTilt: Double = 4
  static let backTilt: Double = 12
  static let frontTilt: Double = 6
  static let spread = Tokens.Space.xs
  static let glyphSize: CGFloat = 12
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
    .overlay { shape.strokeBorder(Tokens.Role.pinnedRestingStroke, lineWidth: Tokens.Hairline.panel) }
    .shadow(Tokens.Shadow.tooltip)
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
      IncognitoGlyph(size: TabStackMetrics.glyphSize)
    } else {
      ZStack {
        if let theme = ToneColor(hex: tab.themeColorHex) { theme.color } else { Rectangle().fill(Tokens.Role.pinnedResting) }
        FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: TabStackMetrics.glyphSize)
      }
    }
  }
}

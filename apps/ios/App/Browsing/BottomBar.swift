import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct BottomBar: View {
  let plusNamespace: Namespace.ID
  let isSearchPresented: Bool
  var onTabs: () -> Void
  var onPlus: () -> Void
  var onMore: () -> Void
  var onStep: (Int) -> Void = { _ in }

  @Environment(AppModel.self) private var app

  var body: some View {
    HStack(spacing: 0) {
        Button(action: onTabs) {
          TabStackGlyph(tabs: Array(app.deckOrder.suffix(2)))
            .frame(width: 47, height: BrowseLayout.hitTarget)
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Tabs")
        .accessibilityValue(Text("^[\(app.deckTabs.count) tab](inflect: true)"))
        .accessibilityActions {
          Button("Previous Tab") { onStep(-1) }
          Button("Next Tab") { onStep(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        ZStack {
          if isSearchPresented {
            Color.clear
          } else {
            Button(action: onPlus) {
              Image(systemName: "plus")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(BrowsePalette.foregroundPrimary)
                .frame(width: BrowseLayout.plusCapsule.width, height: BrowseLayout.plusCapsule.height)
                .contentShape(.capsule)
            }
            .buttonStyle(PressableStyle())
            .background {
              Capsule()
                .fill(BarPalette.plusFill)
                .matchedGeometryEffect(id: "omnibox", in: plusNamespace)
            }
            .transition(.opacity)
            .accessibilityLabel("New Search")
          }
        }
        .frame(width: BrowseLayout.plusCapsule.width, height: BrowseLayout.plusCapsule.height)

        Button(action: onMore) {
          Image(systemName: "chevron.up")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(BrowsePalette.foregroundPrimary)
            .frame(width: BrowseLayout.chevronCircle, height: BrowseLayout.chevronCircle)
            .background(BarPalette.chevronFill, in: .circle)
            .frame(width: BrowseLayout.hitTarget, height: BrowseLayout.hitTarget)
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Page Menu")
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding(.horizontal, BrowseLayout.barSideInset - 4)
  }
}

enum BarPalette {
  static let plusFill = Color.adaptive(light: Color(hex: 0x767680, opacity: 0.2), dark: Color.white.opacity(0.16))
  static let chevronFill = Color.adaptive(light: Color(hex: 0x767680, opacity: 0.16), dark: Color.white.opacity(0.13))
}

struct BarBacking: View {
  let tint: UIColor?

  var body: some View {
    Rectangle()
      .fill(.thinMaterial)
      .overlay {
        if let tint {
          Color(uiColor: tint).opacity(0.55)
        }
      }
      .overlay(alignment: .top) {
        Rectangle()
          .fill(.separator)
          .frame(height: 1 / 3)
      }
  }

  static func isDark(_ color: UIColor?) -> Bool? {
    guard let color else { return nil }
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha), alpha > 0.5 else { return nil }
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.45
  }
}

struct TabStackGlyph: View {
  let tabs: [BrowserTab]

  var body: some View {
    ZStack {
      if tabs.count >= 2 {
        TabThumbnail(tab: tabs[0])
          .rotationEffect(.degrees(-9))
          .offset(x: -3, y: 1)
      }
      if let last = tabs.last {
        TabThumbnail(tab: last)
          .rotationEffect(.degrees(tabs.count >= 2 ? 6 : 0))
          .offset(x: tabs.count >= 2 ? 3 : 0)
      } else {
        RoundedRectangle(cornerRadius: BrowseLayout.tabStackRadius, style: .continuous)
          .strokeBorder(BrowsePalette.foregroundSecondary, lineWidth: 1.5)
          .frame(width: BrowseLayout.tabStackThumb, height: BrowseLayout.tabStackThumb)
      }
    }
    .accessibilityHidden(true)
  }
}

struct TabThumbnail: View {
  let tab: BrowserTab

  @Environment(AppModel.self) private var app
  @State private var image: CGImage?

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: BrowseLayout.tabStackRadius, style: .continuous)
        .fill(.background)
      if let image {
        Image(decorative: image, scale: 1)
          .resizable()
          .scaledToFill()
          .frame(width: BrowseLayout.tabStackThumb, height: BrowseLayout.tabStackThumb, alignment: .top)
      } else if let memory = app.deck.memoryImage(for: tab.id) {
        Image(uiImage: memory)
          .resizable()
          .scaledToFill()
          .frame(width: BrowseLayout.tabStackThumb, height: BrowseLayout.tabStackThumb, alignment: .top)
      } else {
        FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: 14)
      }
    }
    .frame(width: BrowseLayout.tabStackThumb, height: BrowseLayout.tabStackThumb)
    .clipShape(.rect(cornerRadius: BrowseLayout.tabStackRadius, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: BrowseLayout.tabStackRadius, style: .continuous)
        .strokeBorder(.black.opacity(0.12), lineWidth: 0.5)
    }
    .shadow(color: .black.opacity(0.14), radius: 2, y: 1)
    .task(id: tab.snapshotFileName) {
      guard let name = tab.snapshotFileName else { return }
      image = await app.web.snapshots.image(named: name)
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

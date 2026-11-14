import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SpaceSwitcher: View {
  let spaces: [SyncedProfile]
  let current: SyncedProfile?
  var fallbackTitle: LocalizedStringKey = "Tabs"
  let select: (String) -> Void
  @State private var choice = ""

  var body: some View {
    content
      .onAppear { choice = current?.syncId ?? "" }
      .onChange(of: current?.syncId) { _, id in choice = id ?? "" }
      .onChange(of: choice) { _, id in
        if !id.isEmpty, id != current?.syncId { select(id) }
      }
  }

  @ViewBuilder
  private var content: some View {
    if let current, spaces.count > 1 {
      Menu {
        Picker("Space", selection: $choice) {
          ForEach(spaces) { space in
            Label(space.name, systemImage: SpaceGlyph.menuSymbol(for: space)).tag(space.syncId)
          }
        }
      } label: {
        SpaceTitle(space: current, showsChevron: true)
      }
      .menuOrder(.fixed)
      .buttonStyle(.plain)
      .accessibilityLabel("Space, \(current.name)")
      .accessibilityHint("Shows your Mac’s spaces.")
    } else if let current {
      SpaceTitle(space: current, showsChevron: false)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    } else {
      Text(fallbackTitle)
        .font(.headline)
        .foregroundStyle(TabsPalette.headerText)
        .accessibilityAddTraits(.isHeader)
    }
  }
}

struct SpaceTitle: View {
  let space: SyncedProfile
  let showsChevron: Bool

  var body: some View {
    HStack(spacing: 8) {
      SpaceGlyph(space: space)
      Text(space.name)
        .font(.headline)
        .foregroundStyle(TabsPalette.headerText)
        .lineLimit(1)
      if showsChevron {
        Image(systemName: "chevron.down")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
      }
    }
    .frame(minHeight: BrowseLayout.hitTarget)
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(space.name)
  }
}

struct SpaceGlyph: View {
  let space: SyncedProfile
  var size: CGFloat = TabsLayout.spaceBadge

  var body: some View {
    Group {
      if let symbol = SpaceColors.symbol(space.icon) {
        Image(systemName: Self.filled(symbol))
          .font(.system(size: size * 0.85, weight: .semibold))
          .foregroundStyle(TabsPalette.spaceBadgeInk)
          .frame(width: size * 1.25, height: size)
      } else if let emoji = SpaceGlyph.emoji(space.icon) {
        Text(emoji)
          .font(.system(size: size * 0.8))
          .frame(width: size, height: size)
      } else {
        Text(Self.initial(of: space.name))
          .font(.system(size: size * 0.55, weight: .bold))
          .foregroundStyle(TabsPalette.spaceBadgeInk)
          .frame(width: size, height: size)
          .background(TabsPalette.spaceBadge, in: .circle)
      }
    }
    .accessibilityHidden(true)
  }

  static func initial(of name: String) -> String {
    name.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "•"
  }

  static func filled(_ symbol: String) -> String {
    let fill = symbol + ".fill"
    return symbol.hasSuffix(".fill") || UIImage(systemName: fill) == nil ? symbol : fill
  }

  static func emoji(_ icon: String?) -> String? {
    guard let icon, !icon.isEmpty, icon.count <= 2, icon.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation }) else { return nil }
    return icon
  }

  static func menuSymbol(for space: SyncedProfile) -> String {
    if let symbol = SpaceColors.symbol(space.icon) { return filled(symbol) }
    let letter = initial(of: space.name).lowercased()
    let circled = "\(letter).circle.fill"
    return UIImage(systemName: circled) == nil ? "circle.fill" : circled
  }
}

struct SpacePageDots: View {
  let count: Int
  let index: Int

  var body: some View {
    HStack(spacing: TabsLayout.pageDotSpacing) {
      ForEach(0..<count, id: \.self) { dot in
        Circle()
          .fill(dot == index ? AnyShapeStyle(TabsPalette.spaceBadgeInk) : AnyShapeStyle(TabsPalette.pageDot))
          .frame(width: TabsLayout.pageDot, height: TabsLayout.pageDot)
      }
    }
    .animation(.easeOut(duration: 0.2), value: index)
    .accessibilityElement()
    .accessibilityLabel("Space \(index + 1) of \(count)")
  }
}

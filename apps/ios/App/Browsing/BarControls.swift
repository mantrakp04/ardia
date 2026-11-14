import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct BarAddress: Equatable {
  var host: String
  var iconURL: String?
  var pageURL: String?
  var isPrivate: Bool
  var isInsecure: Bool

  init(tab: BrowserTab?, page: WebTab?) {
    let url = page?.url?.absoluteString ?? tab?.url
    host = page?.host ?? url.flatMap(BrowserURL.host(of:)) ?? tab.map(TabText.title(for:)) ?? String(localized: "New Tab")
    iconURL = tab?.faviconURL
    pageURL = url
    isPrivate = tab?.isPrivate ?? false
    if let page, page.url != nil {
      isInsecure = page.security == .insecure
    } else {
      isInsecure = url.flatMap { URL(string: $0)?.scheme?.lowercased() } == "http"
    }
  }
}

struct BarActions {
  var onTabs: () -> Void
  var onAddress: () -> Void
  var onPlus: () -> Void
  var onMore: () -> Void
  var onExpand: () -> Void
  var onStep: (Int) -> Void
  var onSelectTab: (UUID) -> Void
  var onCloseTab: () -> Void
}

struct BarTabsButton: View {
  let actions: BarActions

  @Environment(AppModel.self) private var app

  var body: some View {
    let order = app.deckOrder
    Button(action: actions.onTabs) {
      TabStackGlyph(tabs: Array(order.suffix(2)))
        .frame(width: BrowseLayout.barControl, height: BrowseLayout.barControl)
        .contentShape(.circle)
    }
    .buttonStyle(BarButtonStyle())
    .chromeSurface(in: .circle)
    .classicBarShadow()
    .contextMenu { recentTabsMenu(order) }
    .accessibilityLabel("Tabs")
    .accessibilityValue(Text("^[\(order.count) tab](inflect: true)"))
    .accessibilityHint("Touch and hold for recent tabs.")
    .accessibilityActions {
      Button("Previous Tab") { actions.onStep(-1) }
      Button("Next Tab") { actions.onStep(1) }
    }
  }

  @ViewBuilder
  private func recentTabsMenu(_ order: [BrowserTab]) -> some View {
    let recent = order.filter { $0.id != app.tabs.selectedTabID }.suffix(8).reversed()
    ForEach(Array(recent)) { tab in
      Button(TabText.title(for: tab)) { actions.onSelectTab(tab.id) }
    }
    if !recent.isEmpty { Divider() }
    Button("Close Tab", systemImage: "xmark", role: .destructive, action: actions.onCloseTab)
  }
}

struct BarPlusButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "plus")
        .font(.system(size: BrowseLayout.barGlyph, weight: .medium))
        .foregroundStyle(BrowsePalette.foregroundPrimary)
        .frame(width: BrowseLayout.barControl, height: BrowseLayout.barControl)
        .contentShape(.circle)
    }
    .buttonStyle(BarButtonStyle())
    .chromeSurface(in: .circle)
    .classicBarShadow()
    .accessibilityLabel("New Search")
  }
}

struct BarMenuButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "ellipsis")
        .font(.system(size: BrowseLayout.barMenuGlyph, weight: .semibold))
        .foregroundStyle(BrowsePalette.foregroundPrimary)
        .frame(width: BrowseLayout.barControl, height: BrowseLayout.barControl)
        .contentShape(.rect)
    }
    .buttonStyle(BarButtonStyle())
    .accessibilityLabel("Page Menu")
  }
}

struct BarAddressLabel: View {
  let address: BarAddress
  var compact = false

  @ScaledMetric(relativeTo: .subheadline) private var iconSize: CGFloat = 16
  @ScaledMetric(relativeTo: .subheadline) private var compactIconSize: CGFloat = 13
  @ScaledMetric(relativeTo: .subheadline) private var textSize: CGFloat = 15
  @ScaledMetric(relativeTo: .subheadline) private var compactTextSize: CGFloat = 13.5
  @ScaledMetric(relativeTo: .subheadline) private var warningSize: CGFloat = 13

  var body: some View {
    HStack(spacing: BrowseLayout.barAddressSpacing) {
      if address.isInsecure {
        Text("Not Secure")
          .font(.system(size: warningSize, weight: .medium))
          .foregroundStyle(BrowsePalette.notSecure)
          .lineLimit(1)
          .fixedSize()
      } else {
        siteMark
      }
      Text(address.host)
        .foregroundStyle(BrowsePalette.foregroundPrimary)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .font(.system(size: compact ? compactTextSize : textSize, weight: compact ? .medium : .regular))
    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
  }

  @ViewBuilder
  private var siteMark: some View {
    let size = compact ? compactIconSize : iconSize
    if address.isPrivate {
      Image(systemName: "eyeglasses")
        .font(.system(size: size * 0.92, weight: .regular))
        .foregroundStyle(BrowsePalette.foregroundSecondary)
        .accessibilityHidden(true)
    } else if address.pageURL != nil {
      FaviconImage(iconURL: address.iconURL, pageURL: address.pageURL, size: size)
        .accessibilityHidden(true)
    }
  }
}

struct BarAddressField: View {
  let address: BarAddress
  var showsMenu = true
  let onAddress: () -> Void
  let onMore: () -> Void

  var body: some View {
    HStack(spacing: 0) {
      Button(action: onAddress) {
        BarAddressLabel(address: address)
          .padding(.leading, BrowseLayout.barAddressLead)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
          .contentShape(.rect)
      }
      .buttonStyle(BarButtonStyle())
      .accessibilityLabel(address.isInsecure ? Text("Address, Not Secure") : Text("Address"))
      .accessibilityValue(Text(address.host))
      .accessibilityHint("Opens search with this page’s address.")
      if showsMenu {
        BarMenuButton(action: onMore)
          .padding(.trailing, BrowseLayout.barMenuTrail)
      }
    }
    .frame(height: BrowseLayout.barControl)
    .frame(maxWidth: .infinity)
    .chromeSurface(in: .capsule)
    .classicBarShadow()
  }
}

struct BarCollapsedPill: View {
  let address: BarAddress
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      BarAddressLabel(address: address, compact: true)
        .padding(.horizontal, Spacing.small)
        .frame(height: BrowseLayout.barCollapsedHeight)
        .contentShape(.capsule)
    }
    .buttonStyle(BarButtonStyle())
    .chromeSurface(in: .capsule)
    .classicBarShadow()
    .frame(maxWidth: BrowseLayout.barCollapsedMaxWidth)
    .accessibilityLabel(Text("Show Toolbar"))
    .accessibilityValue(Text(address.host))
  }
}

private struct ClassicBarShadow: ViewModifier {
  @Environment(\.usesGlass) private var usesGlass

  func body(content: Content) -> some View {
    if usesGlass {
      content
    } else {
      content
        .compositingGroup()
        .shadow(color: BrowsePalette.classicBarShadow, radius: BrowseLayout.classicBarShadowRadius, y: 2)
    }
  }
}

extension View {
  func classicBarShadow() -> some View {
    modifier(ClassicBarShadow())
  }
}

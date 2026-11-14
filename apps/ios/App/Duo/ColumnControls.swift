import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SideColumnStack<Content: View>: View {
  let column: ScreenLayout.SideColumn
  let size: CGSize
  @ViewBuilder let content: () -> Content

  var body: some View {
    VStack(spacing: DuoLayout.columnSpacing) {
      content()
    }
    .fixedSize()
    .frame(width: DuoLayout.columnButton, height: room, alignment: .top)
    .position(x: column.centerX(in: size.width), y: column.top + room / 2)
  }

  private var room: CGFloat { max(size.height - column.top, 0) }
}

struct BarSiteButton: View {
  let address: BarAddress
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      mark
        .frame(width: DuoLayout.columnButton, height: DuoLayout.columnButton)
        .contentShape(.circle)
    }
    .buttonStyle(BarButtonStyle())
    .chromeSurface(in: .circle)
    .accessibilityLabel(address.isInsecure ? Text("Address, Not Secure") : Text("Address"))
    .accessibilityValue(Text(address.host))
    .accessibilityHint("Opens search with this page’s address.")
  }

  @ViewBuilder
  private var mark: some View {
    if address.isPrivate {
      Image(systemName: "eyeglasses")
        .font(.system(size: 17, weight: .regular))
        .foregroundStyle(BrowsePalette.foregroundPrimary)
    } else if address.isInsecure {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(BrowsePalette.notSecure)
    } else if address.pageURL != nil {
      FaviconImage(iconURL: address.iconURL, pageURL: address.pageURL, size: 18)
    } else {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 17, weight: .medium))
        .foregroundStyle(BrowsePalette.foregroundPrimary)
    }
  }
}

struct BarRoundMenuButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "ellipsis")
        .font(.system(size: BrowseLayout.barMenuGlyph, weight: .semibold))
        .foregroundStyle(BrowsePalette.foregroundPrimary)
        .frame(width: DuoLayout.columnButton, height: DuoLayout.columnButton)
        .contentShape(.circle)
    }
    .buttonStyle(BarButtonStyle())
    .chromeSurface(in: .circle)
    .accessibilityLabel("Page Menu")
  }
}

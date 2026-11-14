import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct DuoToolbar: View {
  let showsAddress: Bool
  let isSidebarShown: Bool
  let toggleSidebar: () -> Void

  @Environment(AppModel.self) private var app

  var body: some View {
    let page = app.currentPage
    HStack(spacing: DuoLayout.toolbarGap) {
      DuoRoundButton(symbol: "chevron.left", label: "Back", isEnabled: page?.canGoBack ?? false) { page?.goBack() }
      DuoRoundButton(symbol: "chevron.right", label: "Forward", isEnabled: page?.canGoForward ?? false) { page?.goForward() }
      reloadButton(page)
      Spacer(minLength: DuoLayout.toolbarGap)
      if showsAddress {
        DuoAddressCapsule(isSidebarShown: isSidebarShown, toggleSidebar: toggleSidebar)
          .opacity(isSidebarShown ? 0 : 1)
          .allowsHitTesting(!isSidebarShown)
          .accessibilityHidden(isSidebarShown)
        Spacer(minLength: DuoLayout.toolbarGap)
      }
      DuoRoundButton(symbol: "square.and.arrow.up", label: "Share", isEnabled: page?.url != nil) { app.shareCurrentPage() }
      DuoRoundButton(symbol: "ellipsis", label: "Page Menu", isEnabled: app.tabs.selectedTab != nil) {
        app.browse.isToolbarPresented = true
      }
    }
    .padding(.horizontal, DuoLayout.toolbarInset)
    .environment(\.colorScheme, toolbarScheme)
  }

  private var toolbarScheme: ColorScheme {
    guard let tab = app.tabs.selectedTab, let scheme = app.browse.tone(for: tab, page: app.currentPage).top?.scheme else {
      return app.isIncognito ? .dark : systemScheme
    }
    return scheme
  }

  @Environment(\.colorScheme) private var systemScheme

  @ViewBuilder
  private func reloadButton(_ page: WebTab?) -> some View {
    if page?.isLoading == true {
      DuoRoundButton(symbol: "xmark", label: "Stop Loading", isEnabled: true) { page?.stopLoading() }
    } else {
      DuoRoundButton(symbol: "arrow.clockwise", label: "Reload", isEnabled: page != nil) { page?.reload() }
    }
  }
}

struct DuoRoundButton: View {
  let symbol: String
  let label: LocalizedStringKey
  var isEnabled = true
  var diameter = DuoLayout.toolbarButton
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: DuoLayout.toolbarGlyph, weight: .medium))
        .foregroundStyle(isEnabled ? BrowsePalette.foregroundPrimary : BrowsePalette.foregroundTertiary)
        .frame(width: diameter, height: diameter)
        .contentShape(.circle)
    }
    .buttonStyle(BarButtonStyle())
    .chromeSurface(in: .circle)
    .disabled(!isEnabled)
    .accessibilityLabel(label)
  }
}

struct DuoAddressCapsule: View {
  let isSidebarShown: Bool
  let toggleSidebar: () -> Void

  @Environment(AppModel.self) private var app

  var body: some View {
    let address = BarAddress(tab: app.tabs.selectedTab, page: app.currentPage)
    HStack(spacing: 10) {
      Button(action: toggleSidebar) {
        Image(systemName: "sidebar.left")
          .font(.system(size: 17, weight: .regular))
          .foregroundStyle(BrowsePalette.foregroundPrimary)
          .frame(width: 30, height: DuoLayout.addressHeight)
          .contentShape(.rect)
      }
      .buttonStyle(BarButtonStyle())
      .accessibilityLabel(isSidebarShown ? "Hide Sidebar" : "Show Sidebar")
      Button(action: editAddress) {
        DuoHostLabel(address: address)
          .frame(height: DuoLayout.addressHeight)
          .contentShape(.rect)
      }
      .buttonStyle(BarButtonStyle())
      .accessibilityLabel(address.isInsecure ? Text("Address, Not Secure") : Text("Address"))
      .accessibilityValue(Text(address.host))
      .accessibilityHint("Opens search with this page’s address.")
    }
    .padding(.leading, DuoLayout.addressLead - 8)
    .padding(.trailing, DuoLayout.addressTrail)
    .frame(height: DuoLayout.addressHeight)
    .chromeSurface(in: .capsule)
  }

  private func editAddress() {
    guard let tab = app.tabs.selectedTab else {
      app.newTab()
      return
    }
    app.browse.presentSearch(from: .page, text: app.currentQuery(for: tab), selectsAll: true)
  }
}

struct DuoHostLabel: View {
  let address: BarAddress

  @ScaledMetric(relativeTo: .subheadline) private var textSize: CGFloat = 15
  @ScaledMetric(relativeTo: .subheadline) private var lockSize: CGFloat = 13

  var body: some View {
    HStack(spacing: 7) {
      if address.isInsecure {
        Text("Not Secure")
          .foregroundStyle(BrowsePalette.notSecure)
          .fixedSize()
      } else if address.isPrivate {
        Image(systemName: "eyeglasses")
          .font(.system(size: lockSize, weight: .medium))
          .foregroundStyle(BrowsePalette.foregroundSecondary)
          .accessibilityHidden(true)
      } else if address.pageURL != nil {
        Image(systemName: "lock.fill")
          .font(.system(size: lockSize, weight: .medium))
          .foregroundStyle(BrowsePalette.foregroundSecondary)
          .accessibilityHidden(true)
      }
      Text(address.host)
        .foregroundStyle(BrowsePalette.foregroundPrimary)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .font(.system(size: textSize))
    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
  }
}

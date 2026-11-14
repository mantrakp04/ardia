import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageCardControls: View {
  let placement: SidebarPlacement
  let edge: HorizontalEdge
  let showsPageControls: Bool

  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar
  @Environment(\.chromeLayout) private var layout
  @Environment(\.hingeState) private var hinge
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    GlassBar {
      HStack(spacing: SidebarChrome.Card.controlGap) {
        if showsSidebarToggle, edge == .leading {
          sidebarToggle
        }
        if showsPageControls {
          navigation
        }
        Spacer(minLength: 0)
        if placement.showsHostCapsule {
          HostCapsule()
        }
        Spacer(minLength: 0)
        if showsPageControls {
          actions
        }
        if showsSidebarToggle, edge == .trailing {
          sidebarToggle
        }
      }
    }
    .padding(SidebarChrome.Card.controlInset)
    .environment(\.colorScheme, inkScheme)
  }

  private var inkScheme: ColorScheme {
    guard showsPageControls, let tab = app.tabs.selectedTab else { return colorScheme }
    return app.browse.tone(for: tab, page: app.currentPage).top?.scheme ?? colorScheme
  }

  private var page: WebTab? { app.currentPage }

  private var showsSidebarToggle: Bool { placement.cardShowsSidebarToggle }

  private var sidebarToggle: some View {
    CardButton(symbol: edge == .leading ? "sidebar.leading" : "sidebar.trailing", label: (sidebar.toggleAction(layout: layout, hinge: hinge) ?? .show).title, enabled: true) {
      sidebar.toggle(layout: layout, hinge: hinge)
    }
  }

  private var navigation: some View {
    HStack(spacing: SidebarChrome.Card.controlGap) {
      CardButton(symbol: "chevron.backward", label: String(localized: "Back"), enabled: page?.canGoBack == true) { page?.goBack() }
      CardButton(symbol: "chevron.forward", label: String(localized: "Forward"), enabled: page?.canGoForward == true) { page?.goForward() }
      if page?.isLoading == true {
        CardButton(symbol: "xmark", label: String(localized: "Stop Loading"), enabled: true) { page?.stopLoading() }
      } else {
        CardButton(symbol: "arrow.clockwise", label: String(localized: "Reload Page"), enabled: page != nil) { page?.reload() }
      }
    }
  }

  private var actions: some View {
    HStack(spacing: SidebarChrome.Card.controlGap) {
      CardButton(symbol: "square.and.arrow.up", label: String(localized: "Share"), enabled: canShare) { app.shareCurrentPage() }
      PageMenuButton(appScheme: colorScheme)
    }
  }

  private var canShare: Bool {
    app.tabs.selectedTab.map { BrowserURL.isSyncable($0.url) } ?? false
  }
}

struct CardButton: View {
  let symbol: String
  let label: String
  let enabled: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(Typography.body.weight(Tokens.Weight.semibold))
        .frame(width: GlassMetrics.hitTarget, height: GlassMetrics.hitTarget)
        .contentShape(.circle)
    }
    .buttonStyle(.glassControl(.circle))
    .foregroundStyle(enabled ? Tokens.Role.textPrimary : Tokens.Role.iconDisabled)
    .disabled(!enabled)
    .accessibilityLabel(label)
    .help(label)
  }
}

private struct PageMenuButton: View {
  let appScheme: ColorScheme

  @Environment(AppModel.self) private var app
  @State private var menuHeight = PageMenuLayout.minimumHeight

  var body: some View {
    @Bindable var browse = app.browse
    CardButton(symbol: "ellipsis", label: String(localized: "Page Menu"), enabled: app.tabs.selectedTabID != nil) {
      browse.isToolbarPresented = true
    }
    .popover(isPresented: $browse.isToolbarPresented) {
      if let id = app.tabs.selectedTabID {
        menu(for: id)
          .environment(\.colorScheme, appScheme)
      }
    }
    .onChange(of: browse.isToolbarPresented) { _, shown in
      guard !shown else { return }
      Task {
        try? await Task.sleep(for: .seconds(Tokens.Duration.slow))
        app.browse.runMenuFollowUp()
      }
    }
  }

  private func menu(for id: UUID) -> some View {
    ScrollView {
      PageMenuContent(tabID: id)
        .padding(PageMenuLayout.inset)
    }
    .scrollBounceBehavior(.basedOnSize)
    .onScrollGeometryChange(for: CGFloat.self) { geometry in
      geometry.contentSize.height + geometry.contentInsets.top + geometry.contentInsets.bottom
    } action: { _, height in
      menuHeight = height.rounded(.up)
    }
    .frame(width: SidebarChrome.Card.pageMenuWidth, height: min(menuHeight, SidebarChrome.Card.pageMenuMaxHeight))
    .presentationCompactAdaptation(.popover)
  }
}

private struct HostCapsule: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    Button {
      app.editCurrentAddress()
    } label: {
      SiteLabel(tab: app.surface == .search ? nil : app.tabs.selectedTab, page: app.currentPage)
        .padding(.horizontal, Tokens.Space.xl)
        .frame(height: GlassMetrics.hitTarget)
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .foregroundStyle(Tokens.Role.textPrimary)
    .frame(maxWidth: SidebarChrome.Card.hostCapsuleMaxWidth)
    .fixedSize(horizontal: true, vertical: false)
    .glassControl(.capsule)
  }
}

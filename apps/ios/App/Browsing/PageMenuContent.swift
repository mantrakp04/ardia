import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct PageMenuContent: View {
  let tabID: UUID
  let progress: TrayProgress
  let close: () -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colorScheme
  @State private var copies = 0
  @State private var confirmsTranslation = false
  @ScaledMetric(relativeTo: .body) private var stripHeight = BrowseLayout.menuStripHeight
  @ScaledMetric(relativeTo: .body) private var tileHeight = MenuLayout.tileHeight
  @ScaledMetric(relativeTo: .body) private var toggleCircle = BrowseLayout.menuToggleCircle

  private var tab: BrowserTab? { app.tabs.tab(tabID) }
  private var page: WebTab? { app.web.existingWebTab(tabID) }
  private var isWebPage: Bool { tab.map { BrowserURL.isSyncable($0.url) } ?? false }
  private var isLarge: Bool { dynamicTypeSize.isAccessibilitySize }

  var body: some View {
    ViewThatFits(in: .vertical) {
      sections
      ScrollView {
        sections
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .tint(Palette.formAccent)
    .sensoryFeedback(.success, trigger: copies)
    .alert("Translate with Google?", isPresented: $confirmsTranslation) {
      Button("Translate") {
        if let page { app.translate(page) }
        close()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Google will see this page’s address.")
    }
  }

  private var sections: some View {
    VStack(spacing: BrowseLayout.menuGap) {
      navigationStrip
        .modifier(StagedArrival(progress: progress.value, order: 0))
      if let page {
        toggles(page)
          .modifier(StagedArrival(progress: progress.value, order: 1))
      }
      actionTiles
        .modifier(StagedArrival(progress: progress.value, order: 2))
      if let page {
        zoomStrip(page)
          .modifier(StagedArrival(progress: progress.value, order: 3))
      }
      shortcuts
        .modifier(StagedArrival(progress: progress.value, order: 4))
    }
    .padding(.horizontal, BrowseLayout.searchFieldInset)
    .padding(.top, Spacing.hairline)
    .padding(.bottom, Spacing.tight)
  }

  private var rowLayout: AnyLayout {
    isLarge ? AnyLayout(VStackLayout(spacing: BrowseLayout.menuGap)) : AnyLayout(HStackLayout(spacing: BrowseLayout.menuGap))
  }

  private var navigationStrip: some View {
    HStack(spacing: 0) {
      stripButton("chevron.backward", label: "Back", enabled: page?.canGoBack ?? false) {
        page?.goBack()
        close()
      }
      stripButton("chevron.forward", label: "Forward", enabled: page?.canGoForward ?? false) {
        page?.goForward()
        close()
      }
      reloadButton
      pinButton
    }
    .frame(minHeight: stripHeight)
    .menuTile(Capsule(style: .continuous))
  }

  private var pinButton: some View {
    let isPinned = tab.map(app.isPinnedToMac) ?? false
    return stripButton(isPinned ? "star.fill" : "star", label: isPinned ? "Pinned to Mac" : "Pin to Mac", enabled: isWebPage && tab?.isPrivate == false) {
      app.pinCurrentToMac()
    }
    .contentTransition(.symbolEffect(.replace))
    .sensoryFeedback(.success, trigger: isPinned) { _, pinned in pinned }
  }

  @ViewBuilder
  private var reloadButton: some View {
    if page?.isLoading == true {
      stripButton("xmark", label: "Stop", enabled: true) { page?.stopLoading() }
    } else {
      stripButton("arrow.clockwise", label: "Reload", enabled: isWebPage) {
        page?.reload()
        close()
      }
    }
  }

  private func stripButton(_ symbol: String, label: LocalizedStringKey, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.body.weight(.semibold))
        .frame(maxWidth: .infinity, minHeight: stripHeight)
        .contentShape(.rect)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!enabled)
    .accessibilityLabel(label)
  }

  private func toggles(_ page: WebTab) -> some View {
    let blocked = page.blockedResources.count
    return rowLayout {
      Toggle(isOn: Binding(get: { nightShadeIsOn(page) }, set: { app.setNightShade($0, for: page) })) {
        toggleLabel(nightShadeIsOn(page) ? "moon.fill" : "moon", "Night Shade", detail: nightShadeIsOn(page) ? "On" : "Off")
      }
      .toggleStyle(MenuToggleTileStyle(tint: SettingsTint.nightShade, circle: toggleCircle, isLarge: isLarge))
      Toggle(isOn: Binding(
        get: { app.browse.desktopTabs.contains(tabID) },
        set: { wanted in
          guard wanted != app.browse.desktopTabs.contains(tabID) else { return }
          app.toggleDesktopSite(for: page)
          close()
        }
      )) {
        toggleLabel("desktopcomputer", "Desktop Site", detail: app.browse.desktopTabs.contains(tabID) ? "On" : "Off")
      }
      .toggleStyle(MenuToggleTileStyle(tint: SettingsTint.blue, circle: toggleCircle, isLarge: isLarge))
      Toggle(isOn: Binding(
        get: { page.blockersEnabled },
        set: { wanted in
          guard wanted != page.blockersEnabled else { return }
          app.toggleBlockers(for: page)
          close()
        }
      )) {
        toggleLabel(page.blockersEnabled ? "hand.raised.fill" : "hand.raised.slash", "Block Ads", detail: page.blockersEnabled ? (blocked > 0 ? "\(blocked) Blocked" : "On") : "Off")
      }
      .toggleStyle(MenuToggleTileStyle(tint: Palette.success, circle: toggleCircle, isLarge: isLarge))
      .accessibilityLabel("Block Ads and Trackers")
    }
    .disabled(!isWebPage)
  }

  private func toggleLabel(_ symbol: String, _ title: LocalizedStringKey, detail: LocalizedStringKey) -> MenuToggleLabel {
    MenuToggleLabel(symbol: symbol, title: title, detail: detail)
  }

  private func nightShadeIsOn(_ page: WebTab) -> Bool {
    switch app.preferences.nightShade(for: page.host, isPrivate: page.isPrivate) {
    case .disabled: false
    case .always: true
    case .automatic: colorScheme == .dark
    }
  }

  private var actionTiles: some View {
    rowLayout {
      actionTile("doc.plaintext", "Reader") {
        app.browse.readerTabID = tabID
        close()
      }
      actionTile("link", "Copy Link") {
        if app.copyCurrentLink() { copies += 1 }
      }
      actionTile("square.and.arrow.up", "Share") {
        close()
        app.shareCurrentPage()
      }
    }
  }

  private func actionTile(_ symbol: String, _ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(spacing: 6) {
        Image(systemName: symbol)
          .font(.title3)
          .frame(height: 24)
        Text(title)
          .font(.footnote.weight(.medium))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .frame(maxWidth: .infinity, minHeight: tileHeight)
      .menuTile(RoundedRectangle(cornerRadius: BrowseLayout.menuTileRadius, style: .continuous))
      .contentShape(.rect(cornerRadius: BrowseLayout.menuTileRadius, style: .continuous))
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(isWebPage ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!isWebPage)
  }

  private func zoomStrip(_ page: WebTab) -> some View {
    let canZoomOut = page.pageZoom > (WebTab.zoomLevels.first ?? 0.5)
    let canZoomIn = page.pageZoom < (WebTab.zoomLevels.last ?? 3)
    let layout = isLarge
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.tight))
      : AnyLayout(HStackLayout(spacing: Spacing.small))
    return layout {
      HStack(spacing: Spacing.small) {
        Image(systemName: "textformat.size")
          .font(.body)
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
        Text("Page Zoom")
          .font(.subheadline.weight(.medium))
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      HStack(spacing: 0) {
        Button {
          page.zoomOut()
        } label: {
          Image(systemName: "minus").frame(width: 40, height: 34).contentShape(.rect)
        }
        .foregroundStyle(canZoomOut ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
        .disabled(!canZoomOut)
        .accessibilityLabel("Zoom Out")
        Button {
          page.setPageZoom(1)
        } label: {
          Text(page.pageZoom, format: .percent.precision(.fractionLength(0)))
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
            .fixedSize()
            .contentTransition(.numericText(value: page.pageZoom))
            .frame(minWidth: 48)
        }
        .foregroundStyle(.primary)
        .accessibilityLabel("Reset Zoom")
        .accessibilityValue(Text(page.pageZoom, format: .percent.precision(.fractionLength(0))))
        Button {
          page.zoomIn()
        } label: {
          Image(systemName: "plus").frame(width: 40, height: 34).contentShape(.rect)
        }
        .foregroundStyle(canZoomIn ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
        .disabled(!canZoomIn)
        .accessibilityLabel("Zoom In")
      }
      .font(.body.weight(.medium))
      .background(BrowsePalette.menuToggleOff, in: .capsule)
    }
    .buttonStyle(.plain)
    .padding(.leading, Spacing.medium)
    .padding(.trailing, Spacing.tight)
    .padding(.vertical, isLarge ? Spacing.small : 0)
    .frame(minHeight: stripHeight)
    .menuTile(Capsule(style: .continuous))
    .animation(.snappy(duration: 0.2), value: page.pageZoom)
    .disabled(!isWebPage)
  }

  @ViewBuilder
  private var shortcuts: some View {
    let items = shortcutItems
    let columns = isLarge ? [GridItem(.flexible())] : [GridItem(.flexible(), spacing: BrowseLayout.menuGap), GridItem(.flexible())]
    LazyVGrid(columns: columns, spacing: BrowseLayout.menuGap) {
      ForEach(items) { item in
        item.view
      }
    }
  }

  private struct Shortcut: Identifiable {
    let id: String
    let view: AnyView
  }

  private var shortcutItems: [Shortcut] {
    var items = [Shortcut(id: "find", view: AnyView(findShortcut))]
    guard let page else { return items }
    if let send = sendShortcut { items.append(Shortcut(id: "send", view: send)) }
    items.append(Shortcut(id: "translate", view: AnyView(shortcut("translate", "Translate", enabled: isWebPage) { confirmsTranslation = true })))
    if !app.defaultBrowser.isDefault {
      items.append(Shortcut(id: "default", view: AnyView(shortcut("safari", "Open in Default Browser") {
        app.openInDefaultBrowser(page)
        close()
      })))
    }
    return items
  }

  private var findShortcut: some View {
    shortcut("doc.text.magnifyingglass", "Find on Page", enabled: isWebPage) {
      close()
      Task {
        try? await Task.sleep(for: .milliseconds(350))
        page?.presentFindInPage()
      }
    }
  }

  private var sendShortcut: AnyView? {
    let devices = tab.map(app.sendTargets(for:)) ?? []
    guard !devices.isEmpty, let tab, isWebPage else { return nil }
    if devices.count == 1, let device = devices.first {
      return AnyView(shortcut("paperplane", "Send to \(device.name)") {
        app.send(tab, to: device)
        close()
      })
    }
    return AnyView(
      Menu {
        ForEach(devices) { device in
          Button(device.name, systemImage: device.kind == .mac ? "laptopcomputer" : "iphone") {
            app.send(tab, to: device)
            close()
          }
        }
      } label: {
        shortcutLabel("paperplane", "Send to Device")
      }
      .foregroundStyle(.primary)
    )
  }

  private func shortcut(_ symbol: String, _ title: LocalizedStringKey, enabled: Bool = true, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      shortcutLabel(symbol, title)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!enabled)
  }

  private func shortcutLabel(_ symbol: String, _ title: LocalizedStringKey) -> some View {
    HStack(spacing: Spacing.tight + 2) {
      Image(systemName: symbol)
        .font(.body)
        .foregroundStyle(.secondary)
        .frame(width: 22)
        .accessibilityHidden(true)
      Text(title)
        .font(.subheadline.weight(.medium))
        .lineLimit(2)
        .minimumScaleFactor(0.85)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, isLarge ? Spacing.small : 0)
    .frame(maxWidth: .infinity, minHeight: stripHeight)
    .menuTile(RoundedRectangle(cornerRadius: BrowseLayout.menuTileRadius, style: .continuous))
    .contentShape(.rect(cornerRadius: BrowseLayout.menuTileRadius, style: .continuous))
  }
}

struct MenuToggleTileStyle: ToggleStyle {
  let tint: Color
  let circle: CGFloat
  let isLarge: Bool

  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      MenuToggleTile(isOn: configuration.isOn, tint: tint, circle: circle, isLarge: isLarge, label: configuration.label)
    }
    .buttonStyle(PressableStyle())
    .accessibilityRepresentation {
      Toggle(isOn: configuration.$isOn) { configuration.label }
    }
  }
}

private struct MenuToggleTile<Label: View>: View {
  let isOn: Bool
  let tint: Color
  let circle: CGFloat
  let isLarge: Bool
  let label: Label

  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    label
      .foregroundStyle(isEnabled ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
      .environment(\.menuToggleLook, MenuToggleLook(isOn: isOn, tint: tint, circle: circle, isLarge: isLarge))
      .padding(.vertical, Spacing.small)
      .padding(.horizontal, isLarge ? Spacing.page : Spacing.tight)
      .frame(maxWidth: .infinity, alignment: isLarge ? .leading : .center)
      .menuTile(RoundedRectangle(cornerRadius: BrowseLayout.menuTileRadius, style: .continuous))
      .contentShape(.rect(cornerRadius: BrowseLayout.menuTileRadius, style: .continuous))
      .animation(.snappy(duration: 0.2), value: isOn)
  }
}

struct MenuToggleLook {
  var isOn = false
  var tint = Color.accentColor
  var circle: CGFloat = BrowseLayout.menuToggleCircle
  var isLarge = false
}

extension EnvironmentValues {
  @Entry var menuToggleLook = MenuToggleLook()
}

struct MenuToggleLabel: View {
  let symbol: String
  let title: LocalizedStringKey
  let detail: LocalizedStringKey

  @Environment(\.menuToggleLook) private var look
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    let isLit = look.isOn && isEnabled
    let layout = look.isLarge ? AnyLayout(HStackLayout(spacing: Spacing.small)) : AnyLayout(VStackLayout(spacing: 6))
    return layout {
      Image(systemName: symbol)
        .font(.body.weight(.semibold))
        .foregroundStyle(isLit ? AnyShapeStyle(Color.white) : AnyShapeStyle(.primary))
        .frame(width: look.circle, height: look.circle)
        .background(isLit ? look.tint : BrowsePalette.menuToggleOff, in: .circle)
        .contentTransition(.symbolEffect(.replace))
      VStack(alignment: look.isLarge ? .leading : .center, spacing: 1) {
        Text(title)
          .font(.footnote.weight(.semibold))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        Text(detail)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .monospacedDigit()
          .contentTransition(.numericText())
          .lineLimit(1)
      }
    }
  }
}

extension View {
  func menuTile<TileShape: InsettableShape>(_ shape: TileShape) -> some View {
    background {
      shape
        .fill(BrowsePalette.toolbarTile)
        .overlay {
          shape.strokeBorder(
            LinearGradient(colors: [BrowsePalette.menuTileSheen, BrowsePalette.menuTileEdge], startPoint: .top, endPoint: .bottom),
            lineWidth: 1
          )
        }
    }
  }
}

import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct ToolbarSheet: View {
  let tabID: UUID

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colorScheme
  @State private var copies = 0
  @State private var confirmsTranslation = false
  @State private var contentHeight: CGFloat = 560
  @State private var bottomInset: CGFloat = 0
  @ScaledMetric(relativeTo: .body) private var iconSlot: CGFloat = 26
  @ScaledMetric(relativeTo: .body) private var capsuleHeight: CGFloat = MenuLayout.capsuleHeight
  @ScaledMetric(relativeTo: .body) private var tileHeight: CGFloat = MenuLayout.tileHeight

  private var tab: BrowserTab? { app.tabs.tab(tabID) }
  private var page: WebTab? { app.web.existingWebTab(tabID) }
  private var isWebPage: Bool { tab.map { BrowserURL.isSyncable($0.url) } ?? false }

  var body: some View {
    ScrollView {
      VStack(spacing: MenuLayout.inset) {
        navigationCapsule
        tiles
        if let page {
          group {
            findRow
            sendRow
            translateRow
          }
          group {
            nightShadeRow(page)
            zoomRow(page)
            desktopRow(page)
          }
          group {
            blockingRow(page)
            if !app.isDefaultBrowser {
              row("safari", "Open in Default Browser") {
                app.openInDefaultBrowser(page)
                dismiss()
              }
            }
          }
        } else {
          group { findRow }
        }
      }
      .padding(MenuLayout.inset)
      .padding(.bottom, dynamicTypeSize.isAccessibilitySize ? Spacing.large : 0)
    }
    .scrollBounceBehavior(.basedOnSize)
    .ignoresSafeArea(.container, edges: .bottom)
    .onScrollGeometryChange(for: CGFloat.self) { geometry in
      geometry.contentSize.height + geometry.contentInsets.top
    } action: { _, height in
      contentHeight = height.rounded(.up)
    }
    .background {
      Color.clear.onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.bottom } action: { bottomInset = $0 }
    }
    .tint(Palette.indigo)
    .presentationDetents([.height(max(contentHeight - bottomInset, 200))])
    .presentationCornerRadius(MenuLayout.sheetRadius)
    .presentationBackground(Color(.systemGroupedBackground))
    .presentationDragIndicator(.hidden)
    .sensoryFeedback(.success, trigger: copies)
    .alert("Translate with Google?", isPresented: $confirmsTranslation) {
      Button("Translate") {
        if let page { app.translate(page) }
        dismiss()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Google will see this page’s address.")
    }
  }

  private var navigationCapsule: some View {
    let isLarge = dynamicTypeSize.isAccessibilitySize
    return VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 0) {
        backButton
        forwardButton
        if isLarge {
          Spacer(minLength: 0)
        } else {
          titleLabel.lineLimit(1)
        }
        pinButton
        reloadButton
      }
      .frame(minHeight: capsuleHeight)
      if isLarge {
        Divider().padding(.horizontal, Spacing.page)
        titleLabel
          .lineLimit(3)
          .padding(.horizontal, Spacing.tight)
          .padding(.vertical, Spacing.small)
      }
    }
    .padding(.horizontal, Spacing.hairline)
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: isLarge ? MenuLayout.innerRadius : capsuleHeight / 2, style: .continuous))
  }

  private var backButton: some View {
    capsuleButton("chevron.backward", label: "Back", enabled: page?.canGoBack ?? false) {
      page?.goBack()
      dismiss()
    }
  }

  private var forwardButton: some View {
    capsuleButton("chevron.forward", label: "Forward", enabled: page?.canGoForward ?? false) {
      page?.goForward()
      dismiss()
    }
  }

  private var pinButton: some View {
    capsuleButton("star", label: "Pin to Mac", enabled: isWebPage) {
      app.pinCurrentToMac()
    }
  }

  @ViewBuilder
  private var reloadButton: some View {
    if page?.isLoading == true {
      capsuleButton("xmark", label: "Stop", enabled: true) { page?.stopLoading() }
    } else {
      capsuleButton("arrow.clockwise", label: "Reload", enabled: isWebPage) {
        page?.reload()
        dismiss()
      }
    }
  }

  private var titleLabel: some View {
    ZStack {
      if let feedback = app.browse.titleFeedback {
        Text(feedback)
          .fontWeight(.semibold)
          .foregroundStyle(Color.ardiaAccentText)
          .frame(maxWidth: .infinity)
          .transition(.opacity)
      } else {
        Text(titleText)
          .foregroundStyle(.primary)
          .frame(maxWidth: .infinity, alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .center)
          .transition(.opacity)
      }
    }
    .font(.body)
    .padding(.horizontal, Spacing.hairline)
    .contentShape(.rect)
    .onTapGesture { editQuery() }
    .accessibilityAddTraits(.isButton)
    .accessibilityLabel(app.browse.titleFeedback ?? titleText)
    .accessibilityHint("Edits the search")
    .animation(.easeOut(duration: 0.15), value: app.browse.titleFeedback)
  }

  private var titleText: String {
    guard let tab else { return "" }
    let query = app.currentQuery(for: tab)
    if query != tab.url { return query }
    return tab.title.isEmpty ? (BrowserURL.host(of: tab.url) ?? tab.url) : tab.title
  }

  private func capsuleButton(_ symbol: String, label: LocalizedStringKey, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button {
      action()
    } label: {
      Image(systemName: symbol)
        .font(.body.weight(.semibold))
        .frame(minWidth: 44, minHeight: capsuleHeight)
        .padding(.horizontal, dynamicTypeSize.isAccessibilitySize ? Spacing.hairline : 0)
        .contentShape(.rect)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!enabled)
    .accessibilityLabel(label)
  }

  @ViewBuilder
  private var tiles: some View {
    let items = tileItems
    if dynamicTypeSize.isAccessibilitySize {
      group {
        ForEach(items) { item in
          row(item.symbol, item.title, enabled: isWebPage, action: item.action)
        }
      }
    } else {
      HStack(spacing: Spacing.tight) {
        ForEach(items) { item in
          tile(item)
        }
      }
    }
  }

  private struct TileItem: Identifiable {
    let symbol: String
    let title: LocalizedStringKey
    let action: () -> Void
    var id: String { symbol }
  }

  private var tileItems: [TileItem] {
    var items = [
      TileItem(symbol: "doc.plaintext", title: "Reader") {
        app.browse.readerTabID = tabID
        dismiss()
      },
    ]
    if app.offersSummaries {
      items.append(TileItem(symbol: "text.line.magnify", title: "Summarize") {
        dismiss()
        app.browse.requestSummary(for: tabID)
      })
    }
    items.append(TileItem(symbol: "link", title: "Copy Link") {
      if app.copyCurrentLink() { copies += 1 }
    })
    items.append(TileItem(symbol: "square.and.arrow.up", title: "Share") {
      dismiss()
      app.shareCurrentPage()
    })
    return items
  }

  private func tile(_ item: TileItem) -> some View {
    Button(action: item.action) {
      VStack(spacing: 6) {
        Image(systemName: item.symbol)
          .font(.title3)
          .frame(height: 24)
        Text(item.title)
          .font(.footnote.weight(.medium))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .frame(maxWidth: .infinity, minHeight: tileHeight)
      .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: MenuLayout.innerRadius, style: .continuous))
      .contentShape(.rect(cornerRadius: MenuLayout.innerRadius, style: .continuous))
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(isWebPage ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!isWebPage)
  }

  private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    VStack(spacing: 0) {
      Group(subviews: content()) { subviews in
        ForEach(subviews.indices, id: \.self) { index in
          if index > 0 {
            Divider().padding(.leading, Spacing.page + iconSlot + Spacing.small)
          }
          subviews[index]
        }
      }
    }
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: MenuLayout.innerRadius, style: .continuous))
  }

  private var findRow: some View {
    row("doc.text.magnifyingglass", "Find on Page", enabled: isWebPage) {
      dismiss()
      Task {
        try? await Task.sleep(for: .milliseconds(350))
        page?.presentFindInPage()
      }
    }
  }

  private var translateRow: some View {
    row("translate", "Translate", enabled: isWebPage) {
      confirmsTranslation = true
    }
  }

  @ViewBuilder
  private var sendRow: some View {
    let devices = app.sync.devicesThatReceiveTabs
    if app.sync.isEnabled, !devices.isEmpty, let tab, isWebPage {
      if devices.count == 1, let device = devices.first {
        row("paperplane", "Send to \(device.name)") {
          app.send(tab, to: device)
          dismiss()
        }
      } else {
        Menu {
          ForEach(devices) { device in
            Button(device.name, systemImage: device.kind == .mac ? "laptopcomputer" : "iphone") {
              app.send(tab, to: device)
              dismiss()
            }
          }
        } label: {
          rowLabel("paperplane", "Send to Device") {
            Image(systemName: "chevron.up.chevron.down")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.tertiary)
          }
        }
        .foregroundStyle(.primary)
      }
    }
  }

  private func nightShadeIsOn(_ page: WebTab) -> Bool {
    switch app.preferences.nightShade(for: page.host) {
    case .disabled: false
    case .always: true
    case .automatic: colorScheme == .dark
    }
  }

  private func nightShadeRow(_ page: WebTab) -> some View {
    toggleRow(nightShadeIsOn(page) ? "moon.fill" : "moon", "Night Shade", isOn: Binding(
      get: { nightShadeIsOn(page) },
      set: { app.setNightShade($0, for: page) }
    ))
  }

  private func desktopRow(_ page: WebTab) -> some View {
    toggleRow("desktopcomputer", "Desktop Site", isOn: Binding(
      get: { app.browse.desktopTabs.contains(tabID) },
      set: { wanted in
        guard wanted != app.browse.desktopTabs.contains(tabID) else { return }
        app.toggleDesktopSite(for: page)
        dismiss()
      }
    ))
  }

  private func blockingRow(_ page: WebTab) -> some View {
    let count = page.blockedResources.count
    return toggleRow(page.blockersEnabled ? "hand.raised.fill" : "hand.raised.slash", "Block Ads and Trackers", detail: page.blockersEnabled && count > 0 ? Text(count, format: .number) : nil, isOn: Binding(
      get: { page.blockersEnabled },
      set: { wanted in
        guard wanted != page.blockersEnabled else { return }
        app.toggleBlockers(for: page)
        dismiss()
      }
    ))
  }

  private func toggleRow(_ symbol: String, _ title: LocalizedStringKey, detail: Text? = nil, isOn: Binding<Bool>) -> some View {
    Toggle(isOn: isOn) {
      HStack(spacing: Spacing.small) {
        icon(symbol)
        Text(title)
          .frame(maxWidth: .infinity, alignment: .leading)
        if let detail {
          detail
            .font(.subheadline)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .contentTransition(.numericText())
            .accessibilityLabel(Text("Blocked"))
            .accessibilityValue(detail)
        }
      }
    }
    .toggleStyle(.switch)
    .tint(Color(.systemGreen))
    .padding(.leading, Spacing.page)
    .padding(.trailing, Spacing.page)
    .frame(minHeight: MenuLayout.rowHeight)
    .disabled(!isWebPage)
  }

  private func zoomRow(_ page: WebTab) -> some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.tight))
      : AnyLayout(HStackLayout(spacing: Spacing.small))
    let canZoomOut = page.pageZoom > (WebTab.zoomLevels.first ?? 0.5)
    let canZoomIn = page.pageZoom < (WebTab.zoomLevels.last ?? 3)
    return layout {
      HStack(spacing: Spacing.small) {
        icon("textformat.size")
        Text("Page Zoom")
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
      .background(Color(.tertiarySystemFill), in: .capsule)
    }
    .buttonStyle(.plain)
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? Spacing.small : 0)
    .frame(minHeight: MenuLayout.rowHeight)
    .animation(.snappy(duration: 0.2), value: page.pageZoom)
    .disabled(!isWebPage)
  }

  private func icon(_ symbol: String) -> some View {
    Image(systemName: symbol)
      .font(.body)
      .frame(width: iconSlot)
      .foregroundStyle(.secondary)
      .accessibilityHidden(true)
  }

  private func row(_ symbol: String, _ title: LocalizedStringKey, enabled: Bool = true, action: @escaping () -> Void) -> some View {
    Button {
      action()
    } label: {
      rowLabel(symbol, title) { EmptyView() }
    }
    .buttonStyle(MenuRowStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!enabled)
  }

  private func rowLabel<Accessory: View>(_ symbol: String, _ title: LocalizedStringKey, @ViewBuilder accessory: () -> Accessory) -> some View {
    HStack(spacing: Spacing.small) {
      icon(symbol)
      Text(title)
        .frame(maxWidth: .infinity, alignment: .leading)
      accessory()
    }
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, dynamicTypeSize.isAccessibilitySize ? Spacing.small : 0)
    .frame(minHeight: MenuLayout.rowHeight)
    .contentShape(.rect)
  }

  private func editQuery() {
    guard let tab else { return }
    let text = app.currentQuery(for: tab)
    dismiss()
    app.browse.presentSearch(from: .page, text: text, selectsAll: true)
  }
}

private struct MenuRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(configuration.isPressed ? Color(.systemFill) : .clear)
      .animation(.easeOut(duration: configuration.isPressed ? 0 : 0.2), value: configuration.isPressed)
  }
}

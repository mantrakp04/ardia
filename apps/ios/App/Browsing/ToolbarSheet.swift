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
  @State private var windowRoom: CGFloat = .greatestFiniteMagnitude
  @State private var followUp: PageMenuFollowUp?
  @ScaledMetric(relativeTo: .body) private var capsuleHeight: CGFloat = MenuLayout.capsuleHeight

  private var tab: BrowserTab? { app.tabs.tab(tabID) }
  private var page: WebTab? { app.web.existingWebTab(tabID) }
  private var isWebPage: Bool { tab.map { BrowserURL.isSyncable($0.url) } ?? false }

  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        VStack(spacing: PageMenuLayout.barSpacing) {
          navigationCapsule
          actionButtons
        }
        VStack(spacing: PageMenuLayout.groupSpacing) {
          PageMenuGroup {
            findRow
            sendRow
            printRow
          }
          PageMenuGroup {
            PageMenuRow("History") { close(then: .sheet(.history)) }
            PageMenuRow("Bookmarks") { close(then: .sheet(.bookmarks)) }
            PageMenuRow("Downloads") { close(then: .sheet(.downloads)) }
          }
          PageMenuGroup {
            if let page {
              nightShadeRow(page)
              zoomRow(page)
              desktopRow(page)
              translateRow
              blockingRow(page)
            }
            PageMenuRow("Site Settings") { close(then: .siteSettings) }
          }
          if let page, !app.defaultBrowser.isDefault {
            PageMenuGroup {
              PageMenuRow("Open in Default Browser") {
                app.openInDefaultBrowser(page)
                dismiss()
              }
            }
          }
        }
        .padding(.top, PageMenuLayout.groupSpacing)
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
      WindowRoomReader { windowRoom = $0 }
        .accessibilityHidden(true)
    }
    .tint(Palette.formAccent)
    .presentationDetents([menuDetent])
    .presentationCornerRadius(MenuLayout.sheetRadius)
    .presentationBackground(Palette.menuSheet)
    .presentationDragIndicator(.hidden)
    .sensoryFeedback(.success, trigger: copies)
    .onDisappear {
      guard let followUp else { return }
      self.followUp = nil
      app.perform(followUp, on: tabID)
    }
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

  private var menuDetent: PresentationDetent {
    let height = max(contentHeight - bottomInset, 200)
    return height < windowRoom ? .height(height) : .large
  }

  private func close(then next: PageMenuFollowUp) {
    followUp = next
    dismiss()
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
    .chromeSurface(in: .rect(cornerRadius: isLarge ? MenuLayout.innerRadius : capsuleHeight / 2, style: .continuous), interactive: false)
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
    let isPinned = tab.map(app.isPinnedToMac) ?? false
    return capsuleButton(isPinned ? "star.fill" : "star", label: isPinned ? "Pinned to Mac" : "Pin to Mac", enabled: isWebPage && tab?.isPrivate == false) {
      app.pinToMac(tabID)
    }
    .contentTransition(.symbolEffect(.replace))
    .sensoryFeedback(.success, trigger: isPinned) { _, pinned in pinned }
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
        .font(.body.weight(.medium))
        .frame(minWidth: 44, minHeight: capsuleHeight)
        .padding(.horizontal, dynamicTypeSize.isAccessibilitySize ? Spacing.hairline : 0)
        .contentShape(.rect)
    }
    .buttonStyle(PageMenuPressStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!enabled)
    .accessibilityLabel(label)
  }

  private var actionButtons: some View {
    HStack(spacing: PageMenuLayout.barSpacing) {
      actionButton("doc.plaintext", label: "Reader") {
        app.browse.readerTabID = tabID
        dismiss()
      }
      actionButton("link", label: "Copy Link") {
        if app.copyLink(of: tabID) { copies += 1 }
      }
      actionButton("square.and.arrow.up", label: "Share") {
        dismiss()
        app.sharePage(tabID)
      }
    }
  }

  private func actionButton(_ symbol: String, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.body.weight(.medium))
        .frame(maxWidth: .infinity, minHeight: capsuleHeight)
        .contentShape(.capsule)
    }
    .buttonStyle(PageMenuPressStyle())
    .chromeSurface(in: .capsule)
    .foregroundStyle(isWebPage ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(.tertiaryLabel)))
    .disabled(!isWebPage)
    .accessibilityLabel(label)
  }

  private var findRow: some View {
    PageMenuRow("Find on Page", enabled: isWebPage) { close(then: .findOnPage) }
  }

  private var printRow: some View {
    PageMenuRow("Print", enabled: isWebPage && page?.isLive == true) { close(then: .print) }
  }

  private var translateRow: some View {
    PageMenuRow("Translate", enabled: isWebPage) {
      confirmsTranslation = true
    }
  }

  @ViewBuilder
  private var sendRow: some View {
    let devices = tab.map(app.sendTargets(for:)) ?? []
    if !devices.isEmpty, let tab, isWebPage {
      if devices.count == 1, let device = devices.first {
        PageMenuRow("Send to \(device.name)") {
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
          PageMenuRowLabel(title: Text("Send to Device")) {
            Image(systemName: "chevron.up.chevron.down")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.tertiary)
              .accessibilityHidden(true)
          }
        }
        .foregroundStyle(.primary)
      }
    }
  }

  private func nightShadeIsOn(_ page: WebTab) -> Bool {
    switch app.preferences.nightShade(for: page.host, isPrivate: page.isPrivate) {
    case .disabled: false
    case .always: true
    case .automatic: colorScheme == .dark
    }
  }

  private func nightShadeRow(_ page: WebTab) -> some View {
    PageMenuToggleRow(title: "Night Shade", isOn: Binding(
      get: { nightShadeIsOn(page) },
      set: { app.setNightShade($0, for: page) }
    ))
    .disabled(!isWebPage)
  }

  private func desktopRow(_ page: WebTab) -> some View {
    PageMenuToggleRow(title: "Desktop Site", isOn: Binding(
      get: { app.browse.desktopTabs.contains(tabID) },
      set: { wanted in
        guard wanted != app.browse.desktopTabs.contains(tabID) else { return }
        app.toggleDesktopSite(for: page)
        dismiss()
      }
    ))
    .disabled(!isWebPage)
  }

  private func blockingRow(_ page: WebTab) -> some View {
    let count = page.blockedResources.count
    return PageMenuToggleRow(
      title: "Block Ads and Trackers",
      detail: page.blockersEnabled && count > 0 ? Text(count, format: .number) : nil,
      isOn: Binding(
        get: { page.blockersEnabled },
        set: { wanted in
          guard wanted != page.blockersEnabled else { return }
          app.toggleBlockers(for: page)
          dismiss()
        }
      )
    )
    .disabled(!isWebPage)
  }

  private func zoomRow(_ page: WebTab) -> some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.tight))
      : AnyLayout(HStackLayout(spacing: Spacing.small))
    let canZoomOut = page.pageZoom > (WebTab.zoomLevels.first ?? 0.5)
    let canZoomIn = page.pageZoom < (WebTab.zoomLevels.last ?? 3)
    return layout {
      Text("Page Zoom")
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: 0) {
        Button {
          page.zoomOut()
        } label: {
          Image(systemName: "minus")
            .frame(width: PageMenuLayout.zoomButtonWidth, height: PageMenuLayout.zoomHeight)
            .contentShape(.rect)
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
          Image(systemName: "plus")
            .frame(width: PageMenuLayout.zoomButtonWidth, height: PageMenuLayout.zoomHeight)
            .contentShape(.rect)
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

  private func editQuery() {
    guard let tab else { return }
    let text = app.currentQuery(for: tab)
    dismiss()
    app.browse.presentSearch(from: .page, text: text, selectsAll: true)
  }
}

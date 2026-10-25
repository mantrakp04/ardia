import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct ToolbarSheet: View {
  let tabID: UUID

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var copies = 0
  @State private var confirmsTranslation = false
  @ScaledMetric(relativeTo: .body) private var iconSlot: CGFloat = 26

  private var tab: BrowserTab? { app.tabs.tab(tabID) }
  private var page: WebTab? { app.web.existingWebTab(tabID) }
  private var isWebPage: Bool { tab.map { BrowserURL.isSyncable($0.url) } ?? false }
  private var isBrowseForMe: Bool { tab?.origin == .browseForMe }

  var body: some View {
    ScrollView {
      VStack(spacing: Spacing.small) {
        navigationCapsule
        tiles
        rows
      }
      .padding(.horizontal, Spacing.page)
      .padding(.top, Spacing.medium)
      .padding(.bottom, Spacing.page)
    }
    .scrollBounceBehavior(.basedOnSize)
    .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(392), .large])
    .presentationCornerRadius(BrowseLayout.toolbarSheetRadius)
    .presentationDragIndicator(.visible)
    .sensoryFeedback(.success, trigger: copies)
    .alert("Continue with Google Translate?", isPresented: $confirmsTranslation) {
      Button("Continue") {
        if let page { app.translate(page) }
        dismiss()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("The website URL will be passed to Google for translation purposes.")
    }
  }

  @ViewBuilder
  private var navigationCapsule: some View {
    if dynamicTypeSize.isAccessibilitySize {
      VStack(alignment: .leading, spacing: Spacing.tight) {
        HStack(spacing: 0) {
          backButton
          forwardButton
          Spacer(minLength: 0)
          pinButton
          reloadButton
        }
        .frame(minHeight: BrowseLayout.toolbarCapsuleHeight)
        .background(BrowsePalette.toolbarCapsule, in: .capsule)
        titleLabel
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, Spacing.page)
      }
    } else {
      HStack(spacing: 0) {
        backButton
        forwardButton
        titleLabel
          .lineLimit(1)
        pinButton
        reloadButton
      }
      .frame(minHeight: BrowseLayout.toolbarCapsuleHeight)
      .background(BrowsePalette.toolbarCapsule, in: .capsule)
    }
  }

  private var backButton: some View {
    capsuleButton("chevron.left", label: "Go Back", enabled: page?.canGoBack ?? false) {
      page?.goBack()
    }
  }

  private var forwardButton: some View {
    capsuleButton("chevron.right", label: "Go Forward", enabled: page?.canGoForward ?? false) {
      page?.goForward()
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
          .foregroundStyle(Palette.indigo)
          .frame(maxWidth: .infinity)
          .transition(.opacity)
      } else {
        Text(titleText)
          .foregroundStyle(BrowsePalette.foregroundSecondary)
          .frame(maxWidth: .infinity, alignment: .leading)
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
        .font(.system(size: 17, weight: .medium))
        .frame(width: 42, height: BrowseLayout.toolbarCapsuleHeight)
        .contentShape(.rect)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(BrowsePalette.foregroundSecondary)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.35)
    .accessibilityLabel(label)
  }

  @ViewBuilder
  private var tiles: some View {
    if dynamicTypeSize.isAccessibilitySize {
      VStack(spacing: Spacing.small) {
        row("doc.plaintext", "Reader", enabled: isWebPage) {
          app.browse.readerTabID = tabID
          dismiss()
        }
        if app.offersSummaries {
          row("text.line.magnify", "Summarize", enabled: isWebPage) {
            dismiss()
            app.browse.requestSummary(for: tabID)
          }
        }
        row("link", "Copy Link", enabled: isWebPage) {
          if app.copyCurrentLink() { copies += 1 }
        }
        row("square.and.arrow.up", "Share", enabled: isWebPage) {
          dismiss()
          app.shareCurrentPage()
        }
      }
    } else {
      HStack(alignment: .top, spacing: 0) {
        readerTile
        Spacer(minLength: 4)
        if app.offersSummaries {
          summarizeTile
          Spacer(minLength: 4)
        }
        copyTile
        Spacer(minLength: 4)
        shareTile
      }
    }
  }

  private var readerTile: some View {
    tile("doc.plaintext", label: "Reader", enabled: isWebPage) {
      app.browse.readerTabID = tabID
      dismiss()
    }
  }

  private var summarizeTile: some View {
    tile("text.line.magnify", label: "Summarize", enabled: isWebPage) {
      dismiss()
      app.browse.requestSummary(for: tabID)
    }
  }

  private var copyTile: some View {
    tile("link", label: "Copy Link", enabled: isWebPage) {
      if app.copyCurrentLink() { copies += 1 }
    }
  }

  private var shareTile: some View {
    tile("square.and.arrow.up", label: "Share", enabled: isWebPage) {
      dismiss()
      app.shareCurrentPage()
    }
  }

  private func tile(_ symbol: String, label: LocalizedStringKey, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button {
      action()
    } label: {
      VStack(spacing: 6) {
        Image(systemName: symbol)
          .font(.system(size: 24, weight: .regular))
          .frame(width: BrowseLayout.toolbarTile, height: BrowseLayout.toolbarTile)
          .background(BrowsePalette.toolbarTile, in: .rect(cornerRadius: BrowseLayout.toolbarTileRadius, style: .continuous))
        Text(label)
          .font(.footnote)
          .foregroundStyle(BrowsePalette.foregroundSecondary)
          .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
          .minimumScaleFactor(0.8)
          .multilineTextAlignment(.center)
      }
      .frame(minWidth: BrowseLayout.toolbarTile)
      .contentShape(.rect)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(BrowsePalette.foregroundPrimary)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.4)
  }

  @ViewBuilder
  private var rows: some View {
    row("doc.text.magnifyingglass", "Find on Page", enabled: isWebPage) {
      dismiss()
      Task {
        try? await Task.sleep(for: .milliseconds(350))
        page?.presentFindInPage()
      }
    }
    sendRow
    if let page {
      let nightOn = app.preferences.nightShade(for: page.host) != .disabled
      row(nightOn ? "moon.fill" : "moon", nightOn ? "Turn Off Night Shade" : "Night Shade", enabled: isWebPage) {
        app.toggleNightShade(for: page)
      }
      zoomRow(page)
      row(app.browse.desktopTabs.contains(tabID) ? "iphone" : "desktopcomputer", app.browse.desktopTabs.contains(tabID) ? "Request Mobile Site" : "Request Desktop Site", enabled: isWebPage) {
        app.toggleDesktopSite(for: page)
        dismiss()
      }
      row("translate", "Translate", enabled: isWebPage) {
        confirmsTranslation = true
      }
      row(page.blockersEnabled ? "hand.raised.slash" : "hand.raised.fill", page.blockersEnabled ? "Turn Off Blockers for This Site" : "Turn On Blockers for This Site", detail: page.blockersEnabled && page.blockedResources.count > 0 ? Text("\(page.blockedResources.count) Blocked") : nil, enabled: isWebPage) {
        app.toggleBlockers(for: page)
        dismiss()
      }
      if !app.isDefaultBrowser {
        row("safari", "Open in Default Browser", enabled: isWebPage) {
          app.openInDefaultBrowser(page)
          dismiss()
        }
      }
    }
  }

  @ViewBuilder
  private var sendRow: some View {
    let devices = app.sync.devicesThatReceiveTabs
    if app.sync.isEnabled, !devices.isEmpty, let tab, isWebPage {
      if devices.count == 1, let device = devices.first {
        row("paperplane", "Send to \(device.name)", enabled: true) {
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
          rowLabel("paperplane", "Send to Device")
        }
        .foregroundStyle(BrowsePalette.foregroundPrimary)
      }
    }
  }

  private func zoomRow(_ page: WebTab) -> some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.tight))
      : AnyLayout(HStackLayout(spacing: Spacing.small))
    return layout {
      Image(systemName: "textformat.size")
        .font(.body)
        .frame(width: iconSlot)
        .foregroundStyle(BrowsePalette.foregroundSecondary)
        .accessibilityHidden(true)
      Text("Page Zoom")
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: Spacing.small) {
      Button {
        page.zoomOut()
      } label: {
        Image(systemName: "minus").frame(width: 40, height: 40).contentShape(.rect)
      }
      .disabled(page.pageZoom <= (WebTab.zoomLevels.first ?? 0.5))
      .accessibilityLabel("Zoom Out")
      Button {
        page.setPageZoom(1)
      } label: {
        Text(page.pageZoom, format: .percent.precision(.fractionLength(0)))
          .monospacedDigit()
          .fixedSize()
          .contentTransition(.numericText(value: page.pageZoom))
          .frame(minWidth: 52)
      }
      .accessibilityLabel("Reset Zoom")
      Button {
        page.zoomIn()
      } label: {
        Image(systemName: "plus").frame(width: 40, height: 40).contentShape(.rect)
      }
      .disabled(page.pageZoom >= (WebTab.zoomLevels.last ?? 3))
      .accessibilityLabel("Zoom In")
      }
    }
    .buttonStyle(.plain)
    .foregroundStyle(BrowsePalette.foregroundPrimary)
    .padding(.leading, Spacing.page)
    .padding(.trailing, Spacing.tight)
    .frame(minHeight: BrowseLayout.toolbarRowHeight)
    .background(BrowsePalette.toolbarTile, in: .rect(cornerRadius: BrowseLayout.toolbarRowRadius, style: .continuous))
    .animation(.snappy(duration: 0.2), value: page.pageZoom)
    .disabled(!isWebPage)
    .opacity(isWebPage ? 1 : 0.4)
  }

  private func row(_ symbol: String, _ title: LocalizedStringKey, detail: Text? = nil, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button {
      action()
    } label: {
      rowLabel(symbol, title, detail: detail)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(BrowsePalette.foregroundPrimary)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.4)
  }

  private func rowLabel(_ symbol: String, _ title: LocalizedStringKey, detail: Text? = nil) -> some View {
    HStack(spacing: Spacing.small) {
      Image(systemName: symbol)
        .font(.body)
        .frame(width: iconSlot)
        .foregroundStyle(BrowsePalette.foregroundSecondary)
      Text(title)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let detail {
        detail
          .font(.subheadline)
          .monospacedDigit()
          .foregroundStyle(BrowsePalette.foregroundSecondary)
          .fixedSize()
      }
    }
    .padding(.horizontal, Spacing.page)
    .frame(minHeight: BrowseLayout.toolbarRowHeight)
    .background(BrowsePalette.toolbarTile, in: .rect(cornerRadius: BrowseLayout.toolbarRowRadius, style: .continuous))
    .contentShape(.rect)
  }

  private func editQuery() {
    guard let tab else { return }
    let text = app.currentQuery(for: tab)
    dismiss()
    app.browse.presentSearch(from: .page, text: text, selectsAll: true)
  }
}

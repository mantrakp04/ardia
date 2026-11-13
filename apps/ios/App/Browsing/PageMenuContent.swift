import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct PageMenuContent: View {
  let tabID: UUID

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.chromeLayout) private var chromeLayout
  @State private var copies = 0
  @State private var confirmsTranslation = false

  private var tab: BrowserTab? { app.tabs.tab(tabID) }
  private var page: WebTab? { app.web.existingWebTab(tabID) }
  private var isWebPage: Bool { tab.map { BrowserURL.isSyncable($0.url) } ?? false }

  var body: some View {
    VStack(spacing: PageMenuLayout.inset) {
      controls
      PageMenuGroup {
        findRow
        sendRow
        if PagePrinter.isAvailable {
          PageMenuButtonRow(title: "Print", enabled: isWebPage && page != nil) {
            close { app.printCurrentPage() }
          }
        }
      }
      PageMenuGroup {
        ForEach(LibrarySection.allCases) { section in
          PageMenuButtonRow(title: section.title) {
            close { app.openLibrary(section) }
          }
        }
      }
      if let page {
        PageMenuGroup {
          nightShadeRow(page)
          PageZoomRow(page: page, enabled: isWebPage)
          if !chromeLayout.hasSidebar {
            desktopRow(page)
          }
          PageMenuButtonRow(title: "Translate", enabled: isWebPage) {
            confirmsTranslation = true
          }
          blockingRow(page)
          siteSettingsRow
        }
        if !app.defaultBrowser.isDefault {
          PageMenuGroup {
            PageMenuButtonRow(title: "Open in Default Browser") {
              app.openInDefaultBrowser(page)
              close()
            }
          }
        }
      } else {
        PageMenuGroup { siteSettingsRow }
      }
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

  private func close(then followUp: @escaping () -> Void = {}) {
    app.browse.menuFollowUp = followUp
    dismiss()
  }

  @ViewBuilder
  private var controls: some View {
    let items = tileItems
    if dynamicTypeSize.isAccessibilitySize {
      PageMenuHeader(tabID: tabID, close: close)
      PageMenuGroup {
        ForEach(items) { item in
          PageMenuButtonRow(title: item.title, enabled: isWebPage, action: item.action)
        }
      }
    } else {
      VStack(spacing: PageMenuLayout.tileGap) {
        PageMenuHeader(tabID: tabID, close: close)
        GlassBar {
          HStack(spacing: PageMenuLayout.tileGap) {
            ForEach(items) { item in
              PageMenuTile(symbol: item.symbol, title: item.title, enabled: isWebPage, action: item.action)
            }
          }
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
    [
      TileItem(symbol: "doc.plaintext", title: "Reader") {
        close { app.browse.readerTabID = tabID }
      },
      TileItem(symbol: "link", title: "Copy Link") {
        if app.copyCurrentLink() { copies += 1 }
      },
      TileItem(symbol: "square.and.arrow.up", title: "Share") {
        close { app.shareCurrentPage() }
      },
    ]
  }

  private var findRow: some View {
    PageMenuButtonRow(title: "Find on Page", enabled: isWebPage) {
      let page = page
      close { page?.presentFindInPage() }
    }
  }

  private var siteSettingsRow: some View {
    PageMenuButtonRow(title: "Site Settings") {
      close {
        app.settings.pendingRoute = .siteSettings
        app.sheet = .settings
      }
    }
  }

  @ViewBuilder
  private var sendRow: some View {
    let devices = tab.map(app.sendTargets(for:)) ?? []
    if !devices.isEmpty, let tab, isWebPage {
      if devices.count == 1, let device = devices.first {
        PageMenuButtonRow(title: "Send to \(device.name)") {
          app.send(tab, to: device)
          close()
        }
      } else {
        Menu {
          ForEach(devices) { device in
            Button(device.name, systemImage: SystemDevice(id: device.id, name: device.name, kind: device.kind).symbol) {
              app.send(tab, to: device)
              close()
            }
          }
        } label: {
          PageMenuRowLabel(title: "Send to Device") {
            Image(systemName: "chevron.up.chevron.down")
              .font(Typography.caption.weight(Tokens.Weight.semibold))
              .foregroundStyle(Tokens.Role.textTertiary)
          }
        }
        .foregroundStyle(Tokens.Role.textPrimary)
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
    PageMenuToggleRow(
      title: "Night Shade",
      enabled: isWebPage,
      isOn: Binding(get: { nightShadeIsOn(page) }, set: { app.setNightShade($0, for: page) })
    )
  }

  private func desktopRow(_ page: WebTab) -> some View {
    PageMenuToggleRow(title: "Desktop Site", enabled: isWebPage, isOn: Binding(
      get: { page.siteVersionOverride == .desktop },
      set: { wanted in
        guard wanted != (page.siteVersionOverride == .desktop) else { return }
        app.toggleDesktopSite(for: page)
        close()
      }
    ))
  }

  private func blockingRow(_ page: WebTab) -> some View {
    let count = page.blockedResources.count
    return PageMenuToggleRow(
      title: "Block Ads and Trackers",
      detail: page.blockersEnabled && count > 0 ? Text(count, format: .number) : nil,
      enabled: isWebPage,
      isOn: Binding(
        get: { page.blockersEnabled },
        set: { wanted in
          guard wanted != page.blockersEnabled else { return }
          app.toggleBlockers(for: page)
          close()
        }
      )
    )
  }
}

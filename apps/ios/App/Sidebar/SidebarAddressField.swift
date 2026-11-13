import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SidebarAddressField: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let tab = app.surface == .search ? nil : app.tabs.selectedTab
    Button {
      app.editCurrentAddress()
    } label: {
      SiteLabel(tab: tab, page: app.currentPage)
        .padding(.horizontal, SidebarChrome.RowParts.contentLeading)
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: GlassMetrics.hitTarget, alignment: .leading)
        .contentShape(.capsule)
    }
    .buttonStyle(.glassControl(.capsule))
    .foregroundStyle(Tokens.Role.textPrimary)
    .accessibilityLabel(SiteLabel.summary(tab: tab, page: app.currentPage).spokenAddress)
    .accessibilityHint(String(localized: "Opens the command bar."))
  }
}

struct SiteLabel: View {
  let tab: BrowserTab?
  let page: WebTab?

  var body: some View {
    let summary = Self.summary(tab: tab, page: page)
    HStack(spacing: SidebarChrome.RowParts.titleGap) {
      if let glyph = summary.labelGlyph {
        AddressGlyphView(glyph: glyph, tab: tab, size: SidebarMetrics.Row.icon)
      }
      if summary.isNotSecure {
        NotSecureWords()
      }
      Text(summary.text)
        .font(Typography.row)
        .foregroundStyle(summary.kind == .empty ? Tokens.Role.placeholder : Tokens.Role.textPrimary)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(summary.spokenAddress)
  }

  static func summary(tab: BrowserTab?, page: WebTab?) -> AddressSummary {
    AddressSummary(
      tab: tab,
      page: tab == nil ? nil : page,
      usesFavicon: false,
      placeholder: String(localized: "Search or Enter Address")
    )
  }
}

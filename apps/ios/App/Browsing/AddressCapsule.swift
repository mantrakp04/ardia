import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

enum BarMorph {
  static let tabs = "bar.tabs"
  static let address = "bar.address"
  static let menu = "bar.menu"
  static let plus = "bar.plus"
}

extension AddressSummary {
  init(tab: BrowserTab?, page: WebTab?, usesFavicon: Bool = true, placeholder: String = String(localized: "Search or enter address")) {
    self.init(
      address: page?.url?.absoluteString ?? tab?.url ?? "",
      title: page?.title.isEmpty == false ? page?.title ?? "" : tab?.title ?? "",
      security: AddressSecurity(page?.security),
      isPrivate: tab?.isPrivate ?? false,
      hasFavicon: usesFavicon && tab?.faviconURL != nil,
      placeholder: placeholder
    )
  }

  var accessibilityText: String {
    var parts = [text]
    if isPrivate { parts.append(String(localized: "Private")) }
    if isNotSecure { parts.append(String(localized: "Not Secure")) }
    return parts.joined(separator: ", ")
  }

  var spokenAddress: String {
    kind == .empty ? text : String(localized: "Address, \(accessibilityText)")
  }
}

extension AddressSecurity {
  init(_ security: PageSecurity?) {
    switch security {
    case .some(.secure): self = .secure
    case .some(.mixed): self = .mixed
    case .some(.insecure): self = .insecure
    case .some(.none), nil: self = .unknown
    }
  }
}

struct AddressGlyphView: View {
  let glyph: AddressGlyph
  let tab: BrowserTab?
  let size: CGFloat

  var body: some View {
    Group {
      if glyph == .favicon, let tab {
        FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: size)
      } else if let symbol = glyph.symbolName {
        Image(systemName: symbol)
          .font(size < BarMetrics.addressGlyph ? Typography.badge : Typography.caption)
          .fontWeight(Tokens.Weight.semibold)
          .foregroundStyle(glyph == .notSecure ? AnyShapeStyle(Tokens.Role.warning) : AnyShapeStyle(Tokens.Role.textSecondary))
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

struct NotSecureWords: View {
  var body: some View {
    Text("Not Secure")
      .font(Typography.caption.weight(Tokens.Weight.semibold))
      .foregroundStyle(Tokens.Role.warning)
      .fixedSize()
  }
}

struct AddressLabel: View {
  let summary: AddressSummary
  let tab: BrowserTab?
  var isCompact = false

  var body: some View {
    HStack(spacing: BarMetrics.addressGap) {
      if let glyph = summary.labelGlyph {
        AddressGlyphView(glyph: glyph, tab: tab, size: isCompact ? BarMetrics.compactGlyph : BarMetrics.addressGlyph)
      }
      if summary.isNotSecure {
        NotSecureWords()
      }
      Text(summary.text)
        .font(isCompact ? Typography.caption.weight(Tokens.Weight.medium) : Typography.row)
        .foregroundStyle(summary.kind == .empty ? AnyShapeStyle(Tokens.Role.textTertiary) : AnyShapeStyle(Tokens.Role.textPrimary))
        .lineLimit(1)
        .truncationMode(.middle)
    }
  }
}

struct AddressCapsule: View {
  let tab: BrowserTab?
  let page: WebTab?
  let onSearch: () -> Void
  let onMenu: () -> Void

  var body: some View {
    let summary = AddressSummary(tab: tab, page: page)
    HStack(spacing: 0) {
      Button(action: onSearch) {
        AddressLabel(summary: summary, tab: tab)
          .padding(.leading, Tokens.Space.l)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .contextMenu { AddressMenu() }
      .accessibilityLabel(Text("Address, \(summary.accessibilityText)"))
      .accessibilityHint("Edits the address.")
      Button(action: onMenu) {
        Image(systemName: "ellipsis")
          .font(Typography.body.weight(Tokens.Weight.semibold))
          .foregroundStyle(Tokens.Role.textPrimary)
          .frame(width: GlassMetrics.hitTarget, height: BarMetrics.pieceHeight)
          .contentShape(.rect)
      }
      .buttonStyle(PressableStyle())
      .accessibilityLabel("Page Menu")
    }
    .frame(maxWidth: .infinity)
    .frame(height: BarMetrics.pieceHeight)
    .glassControl(.capsule, morphID: BarMorph.address)
  }
}

struct AddressMenu: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let canShare = app.tabs.selectedTab.map { BrowserURL.isSyncable($0.url) } ?? false
    Button("Copy Link", systemImage: "link") { app.copyCurrentLink() }
      .disabled(!canShare)
    if UIPasteboard.general.hasStrings {
      Button("Paste and Go", systemImage: "doc.on.clipboard") {
        guard let text = UIPasteboard.general.string else { return }
        app.submitSearch(text, resolution: nil)
      }
    }
    Button("Share", systemImage: "square.and.arrow.up") { app.shareCurrentPage() }
      .disabled(!canShare)
  }
}

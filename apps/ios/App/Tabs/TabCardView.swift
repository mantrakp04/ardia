import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct TabCardContent: View {
  let tab: BrowserTab
  let isIncognito: Bool
  let memoryImage: UIImage?
  let snapshots: TabSnapshotStore

  @State private var stored: CGImage?

  var body: some View {
    ZStack(alignment: .top) {
      background
      if let memoryImage {
        Image(uiImage: memoryImage)
          .resizable()
          .scaledToFit()
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      } else if let stored {
        Image(decorative: stored, scale: 1)
          .resizable()
          .scaledToFit()
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      } else {
        placeholder
      }
    }
    .clipped()
    .task(id: tab.snapshotFileName) {
      guard memoryImage == nil, let name = tab.snapshotFileName else { return }
      stored = await snapshots.image(named: name)
    }
  }

  private var background: Color {
    if isIncognito { return TabsPalette.incognitoCard }
    if let hex = tab.themeColorHex, let color = Color(hexString: hex) { return color }
    if tab.origin == .browseForMe { return TabsPalette.browsePage }
    return Color(.systemBackground)
  }

  @ViewBuilder private var placeholder: some View {
    if isIncognito {
      IncognitoCardPlaceholder(title: TabText.title(for: tab))
    } else if tab.origin == .browseForMe {
      BrowseForMeCardPlaceholder(title: TabText.title(for: tab))
    } else {
      PageCardPlaceholder(tab: tab)
    }
  }
}

struct PageCardPlaceholder: View {
  let tab: BrowserTab
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let theme = tab.themeColorHex.flatMap { Color(hexString: $0) }
    let ink: Color? = theme == nil ? nil : (ThemeInk.isLight(tab.themeColorHex) ? .black : .white)
    VStack(alignment: .leading, spacing: 12) {
      FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: 32)
      Text(TabText.title(for: tab))
        .font(.headline)
        .foregroundStyle(ink.map { AnyShapeStyle($0) } ?? AnyShapeStyle(.primary))
        .lineLimit(4)
      Text(TabText.host(for: tab))
        .font(.subheadline)
        .foregroundStyle(ink.map { AnyShapeStyle($0.opacity(0.7)) } ?? AnyShapeStyle(.secondary))
        .lineLimit(1)
    }
    .padding(16)
    .padding(.top, 48)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(theme ?? pastel)
  }

  private var pastel: Color {
    let tints = colorScheme == .dark ? TabsPalette.placeholderTintsDark : TabsPalette.placeholderTints
    let host = BrowserURL.host(of: tab.url) ?? tab.url
    let value = host.unicodeScalars.reduce(UInt32(5381)) { ($0 &<< 5) &+ $0 &+ $1.value }
    return Color(hex: tints[Int(value % UInt32(tints.count))])
  }
}

struct BrowseForMeCardPlaceholder: View {
  let title: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Browse for Me", systemImage: "sparkle.magnifyingglass")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
      Text(title)
        .font(.system(.title3, design: .rounded, weight: .bold))
        .foregroundStyle(Palette.indigo)
        .lineLimit(5)
    }
    .padding(16)
    .padding(.top, 44)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(TabsPalette.browsePage)
  }
}

struct IncognitoCardPlaceholder: View {
  let title: String

  var body: some View {
    VStack(spacing: 12) {
      IncognitoGlyph(size: 44)
      Text("Incognito Tab")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.white.opacity(0.85))
      Text(title)
        .font(.caption)
        .foregroundStyle(.white.opacity(0.55))
        .lineLimit(2)
        .multilineTextAlignment(.center)
    }
    .padding(.horizontal, 14)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct IncognitoGlyph: View {
  let size: CGFloat

  var body: some View {
    HStack(spacing: size * 0.12) {
      eye
      eye
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private var eye: some View {
    Capsule()
      .fill(.white)
      .frame(width: size * 0.2, height: size * 0.42)
      .overlay(alignment: .bottom) {
        Circle()
          .fill(TabsPalette.incognitoCard)
          .frame(width: size * 0.13)
          .padding(.bottom, size * 0.04)
      }
  }
}

struct ReceivedBadge: View {
  var body: some View {
    Label("From Your Mac", systemImage: "macbook")
      .font(.caption2.weight(.semibold))
      .labelStyle(.titleAndIcon)
      .foregroundStyle(.white)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(TabsPalette.receivedBadge, in: .capsule)
      .shadow(color: TabsPalette.receivedBadge.opacity(0.35), radius: 6, y: 2)
  }
}

enum TabText {
  static func title(for tab: BrowserTab) -> String {
    let trimmed = tab.title.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return trimmed }
    return host(for: tab)
  }

  static func host(for tab: BrowserTab) -> String {
    BrowserURL.host(of: tab.url) ?? (tab.origin == .browseForMe ? String(localized: "Browse for Me") : String(localized: "New Tab"))
  }

  static func isUnseenReceived(_ tab: BrowserTab) -> Bool {
    tab.origin == .sent && tab.receivedKey != nil && tab.lastActive <= tab.created
  }
}

enum ThemeInk {
  static func isLight(_ hex: String?) -> Bool {
    guard var text = hex?.trimmingCharacters(in: .whitespaces) else { return true }
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6, let value = UInt32(text, radix: 16) else { return true }
    func linear(_ channel: UInt32) -> Double {
      let c = Double(channel) / 255
      return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }
    let luminance = 0.2126 * linear((value >> 16) & 0xFF) + 0.7152 * linear((value >> 8) & 0xFF) + 0.0722 * linear(value & 0xFF)
    return luminance > 0.36
  }
}

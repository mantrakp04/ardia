import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageLoadingPlaceholder: View {
  let tab: BrowserTab

  var body: some View {
    let theme = PageTheme(hex: tab.themeColorHex)
    let host = BrowserURL.host(of: tab.url)
    let title = PageLoadingPlaceholder.distinctTitle(tab.title, host: host)
    VStack(spacing: Spacing.small) {
      FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: 44)
        .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
      if let title {
        Text(title)
          .font(.headline)
          .multilineTextAlignment(.center)
          .lineLimit(3)
          .foregroundStyle(theme?.ink ?? BrowsePalette.foregroundPrimary)
      }
      if let host {
        Text(host)
          .font(title == nil ? .headline : .subheadline)
          .lineLimit(1)
          .foregroundStyle(title == nil ? (theme?.ink ?? BrowsePalette.foregroundPrimary) : (theme?.ink.opacity(0.65) ?? BrowsePalette.foregroundSecondary))
      }
    }
    .padding(.horizontal, Spacing.section)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(theme?.color ?? BrowsePalette.pageBackdrop)
    .ignoresSafeArea()
    .accessibilityElement(children: .combine)
    .accessibilityLabel(Text("Loading \(TabText.title(for: tab))"))
  }

  static func distinctTitle(_ title: String, host: String?) -> String? {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return host == nil ? String(localized: "New Tab") : nil }
    guard let host else { return trimmed }
    let bare = { (text: String) in text.lowercased().replacingOccurrences(of: "www.", with: "") }
    if bare(trimmed) == bare(host) || trimmed.lowercased().hasPrefix("http") { return nil }
    return trimmed
  }
}

struct PageTheme {
  let color: Color
  let ink: Color

  init?(hex: String?) {
    guard let hex, var value = Optional(hex.trimmingCharacters(in: .whitespaces)) else { return nil }
    if value.hasPrefix("#") { value.removeFirst() }
    guard value.count == 6, let number = UInt32(value, radix: 16) else { return nil }
    let red = Double((number >> 16) & 0xFF) / 255
    let green = Double((number >> 8) & 0xFF) / 255
    let blue = Double(number & 0xFF) / 255
    let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    guard luminance < 0.94 else { return nil }
    color = Color(hex: number)
    ink = luminance > 0.55 ? Color.black.opacity(0.85) : Color.white.opacity(0.92)
  }
}

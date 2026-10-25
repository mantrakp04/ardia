import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageLoadingPlaceholder: View {
  let tab: BrowserTab

  var body: some View {
    let theme = PageTheme(hex: tab.themeColorHex)
    VStack(spacing: Spacing.small) {
      FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: 44)
        .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
      Text(tab.title.isEmpty ? (BrowserURL.host(of: tab.url) ?? tab.url) : tab.title)
        .font(.headline)
        .multilineTextAlignment(.center)
        .lineLimit(3)
        .foregroundStyle(theme?.ink ?? BrowsePalette.foregroundPrimary)
      if let host = BrowserURL.host(of: tab.url) {
        Text(host)
          .font(.subheadline)
          .foregroundStyle(theme?.ink.opacity(0.65) ?? BrowsePalette.foregroundSecondary)
      }
    }
    .padding(.horizontal, Spacing.section)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(theme?.color ?? BrowsePalette.pageBackdrop)
    .ignoresSafeArea()
    .accessibilityElement(children: .combine)
    .accessibilityLabel(Text("Loading \(tab.title)"))
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

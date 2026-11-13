import ArdiaBrowser
import SwiftUI

extension ToneColor {
  var color: Color { Color(.sRGB, red: red, green: green, blue: blue) }

  var scheme: ColorScheme { isDark ? .dark : .light }
}

extension BrowseSession {
  func tone(for tab: BrowserTab, page: WebTab?) -> PageTone {
    PageTone.resolve(theme: page?.themeColor, underPage: page?.underPageBackgroundColor, sampled: tones[tab.id], stored: tab.themeColorHex)
  }
}

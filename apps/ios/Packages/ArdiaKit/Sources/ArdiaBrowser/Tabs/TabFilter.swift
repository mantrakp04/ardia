import Foundation

public enum TabFilter {
  public static func matching(_ tabs: [BrowserTab], query: String) -> [BrowserTab] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !needle.isEmpty else { return tabs }
    return tabs.filter { matches($0, needle: needle) }
  }

  static func matches(_ tab: BrowserTab, needle: String) -> Bool {
    tab.title.localizedStandardContains(needle) || tab.url.localizedStandardContains(needle) || readableAddress(tab.url).localizedStandardContains(needle)
  }

  static func readableAddress(_ url: String) -> String {
    guard let components = URLComponents(string: url), let host = components.host else { return url }
    let bare = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    return bare + components.path
  }
}

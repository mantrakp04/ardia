import ArdiaBrowser
import Foundation
import SwiftUI

enum LibrarySection: String, CaseIterable, Identifiable, Hashable {
  case history
  case bookmarks
  case downloads

  var id: String { rawValue }

  var title: LocalizedStringKey {
    switch self {
    case .history: "History"
    case .bookmarks: "Bookmarks"
    case .downloads: "Downloads"
    }
  }

  var symbol: String {
    switch self {
    case .history: "clock"
    case .bookmarks: "book"
    case .downloads: "arrow.down.circle"
    }
  }
}

extension AppModel {
  func openLibrary(_ section: LibrarySection) {
    sheet = .library(section)
  }

  func openFromLibrary(_ address: String) {
    guard let url = URL(string: address) else { return }
    sheet = nil
    openPage(url, origin: .typed)
  }

  func copyLibraryLink(_ address: String) {
    guard let url = URL(string: address) else { return }
    web.copyLink(url)
    toasts.show(.copiedURLWithoutTrackers)
  }

  var pageToPinFromLibrary: BrowserTab? {
    guard sync.isEnabled, let tab = tabs.selectedTab, !tab.isPrivate, BrowserURL.isSyncable(tab.url) else { return nil }
    return tab
  }
}

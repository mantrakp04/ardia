import ArdiaDesign
import Foundation

extension BrowserCommand {
  var title: String {
    switch self {
    case .newTab: String(localized: "New Tab")
    case .newIncognitoTab: String(localized: "New Incognito Tab")
    case .reopenClosedTab: String(localized: "Reopen Closed Tab")
    case .closeTab: String(localized: "Close Tab")
    case .openLocation: String(localized: "Open Location")
    case .copyLink: String(localized: "Copy Link")
    case .share: String(localized: "Share…")
    case .print: String(localized: "Print…")
    case .reload: String(localized: "Reload Page")
    case .stop: String(localized: "Stop Loading")
    case .back: String(localized: "Back")
    case .forward: String(localized: "Forward")
    case .findInPage: String(localized: "Find on Page…")
    case .findNext: String(localized: "Find Next")
    case .findPrevious: String(localized: "Find Previous")
    case .zoomIn: String(localized: "Zoom In")
    case .zoomOut: String(localized: "Zoom Out")
    case .actualSize: String(localized: "Actual Size")
    case .toggleSidebar: String(localized: "Show or Hide Sidebar")
    case .nextTab: String(localized: "Next Tab")
    case .previousTab: String(localized: "Previous Tab")
    case .selectLastTab: String(localized: "Last Tab")
    case .selectTab1, .selectTab2, .selectTab3, .selectTab4, .selectTab5, .selectTab6, .selectTab7, .selectTab8:
      String(localized: "Tab \(tabNumber ?? 0)")
    case .nextSpace: String(localized: "Next Space")
    case .previousSpace: String(localized: "Previous Space")
    case .showHistory: String(localized: "History")
    case .showBookmarks: String(localized: "Bookmarks")
    case .showDownloads: String(localized: "Downloads")
    case .settings: String(localized: "Settings…")
    }
  }
}

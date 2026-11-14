public enum BrowserCommand: String, CaseIterable, Sendable {
  case newTab
  case newIncognitoTab
  case reopenClosedTab
  case closeTab
  case openLocation
  case copyLink
  case share
  case print
  case reload
  case stop
  case back
  case forward
  case findInPage
  case findNext
  case findPrevious
  case zoomIn
  case zoomOut
  case actualSize
  case toggleSidebar
  case nextTab
  case previousTab
  case selectTab1
  case selectTab2
  case selectTab3
  case selectTab4
  case selectTab5
  case selectTab6
  case selectTab7
  case selectTab8
  case selectLastTab
  case nextSpace
  case previousSpace
  case showHistory
  case showBookmarks
  case showDownloads
  case settings

  public static let numberedTabs: [BrowserCommand] = [
    .selectTab1, .selectTab2, .selectTab3, .selectTab4, .selectTab5, .selectTab6, .selectTab7, .selectTab8, .selectLastTab,
  ]

  public var macName: String {
    switch self {
    case .newIncognitoTab: "newIncognitoWindow"
    case .openLocation: "focusCommandBar"
    case .copyLink: "copyUrl"
    case .actualSize: "zoomReset"
    case .nextSpace: "nextProfile"
    case .previousSpace: "previousProfile"
    case .showBookmarks: "manageBookmarks"
    case .showDownloads: "downloads"
    case .settings: "openSettings"
    case .selectTab1, .selectTab2, .selectTab3, .selectTab4, .selectTab5, .selectTab6, .selectTab7, .selectTab8:
      "selectTab:\(tabNumber ?? 0)"
    default: rawValue
    }
  }

  public var tabNumber: Int? {
    Self.numberedTabs.firstIndex(of: self).map { $0 + 1 }
  }

  public func tabIndex(count: Int) -> Int? {
    guard let number = tabNumber, count > 0 else { return nil }
    if self == .selectLastTab { return count - 1 }
    return number <= count ? number - 1 : nil
  }

  public var primaryShortcut: CommandShortcut? { shortcuts.first }

  public var shortcuts: [CommandShortcut] {
    switch self {
    case .newTab: [CommandShortcut("t", [.command])]
    case .newIncognitoTab: [CommandShortcut("n", [.shift, .command])]
    case .reopenClosedTab: [CommandShortcut("t", [.shift, .command])]
    case .closeTab: [CommandShortcut("w", [.command])]
    case .openLocation: [CommandShortcut("l", [.command])]
    case .copyLink: [CommandShortcut("c", [.shift, .command])]
    case .share: [CommandShortcut("s", [.option, .command])]
    case .print: [CommandShortcut("p", [.command])]
    case .reload: [CommandShortcut("r", [.command])]
    case .stop: [CommandShortcut(".", [.command])]
    case .back: [CommandShortcut("[", [.command]), CommandShortcut("\u{F702}", [.command])]
    case .forward: [CommandShortcut("]", [.command]), CommandShortcut("\u{F703}", [.command])]
    case .findInPage: [CommandShortcut("f", [.command])]
    case .findNext: [CommandShortcut("g", [.command])]
    case .findPrevious: [CommandShortcut("g", [.shift, .command])]
    case .zoomIn: [CommandShortcut("+", [.command]), CommandShortcut("=", [.command])]
    case .zoomOut: [CommandShortcut("-", [.command])]
    case .actualSize: [CommandShortcut("0", [.command])]
    case .toggleSidebar: [CommandShortcut("s", [.command]), CommandShortcut("l", [.shift, .command]), CommandShortcut("f", [.shift, .command])]
    case .nextTab:
      [CommandShortcut("]", [.shift, .command]), CommandShortcut("}", [.command]), CommandShortcut("\u{F72D}", [.control]), CommandShortcut("\u{F701}", [.option, .command])]
    case .previousTab:
      [CommandShortcut("[", [.shift, .command]), CommandShortcut("{", [.command]), CommandShortcut("\u{F72C}", [.control]), CommandShortcut("\u{F700}", [.option, .command])]
    case .selectTab1, .selectTab2, .selectTab3, .selectTab4, .selectTab5, .selectTab6, .selectTab7, .selectTab8:
      [CommandShortcut(String(tabNumber ?? 0), [.command])]
    case .selectLastTab: [CommandShortcut("9", [.command])]
    case .nextSpace: [CommandShortcut("\u{F703}", [.option, .command])]
    case .previousSpace: [CommandShortcut("\u{F702}", [.option, .command])]
    case .showHistory: [CommandShortcut("y", [.command])]
    case .showBookmarks: [CommandShortcut("b", [.option, .command])]
    case .showDownloads: [CommandShortcut("j", [.shift, .command]), CommandShortcut("l", [.option, .command])]
    case .settings: [CommandShortcut(",", [.command])]
    }
  }
}

public enum TabStep {
  public static func index(from current: Int?, by delta: Int, count: Int) -> Int? {
    guard count > 0 else { return nil }
    guard let current else { return delta >= 0 ? 0 : count - 1 }
    guard count > 1 else { return nil }
    return ((current + delta) % count + count) % count
  }
}

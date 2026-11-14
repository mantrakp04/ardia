public struct CommandFront: Equatable, Sendable {
  public var hasModal: Bool
  public var isSearching: Bool
  public var showsPage: Bool
  public var canPrint: Bool
  public var canToggleSidebar: Bool
  public var hasSeveralSpaces: Bool

  public init(
    hasModal: Bool = false,
    isSearching: Bool = false,
    showsPage: Bool = false,
    canPrint: Bool = false,
    canToggleSidebar: Bool = false,
    hasSeveralSpaces: Bool = false
  ) {
    self.hasModal = hasModal
    self.isSearching = isSearching
    self.showsPage = showsPage
    self.canPrint = canPrint
    self.canToggleSidebar = canToggleSidebar
    self.hasSeveralSpaces = hasSeveralSpaces
  }
}

public enum CommandAvailability {
  public static func allows(_ command: BrowserCommand, in front: CommandFront) -> Bool {
    guard !front.hasModal, !front.isSearching else { return false }
    switch command {
    case .closeTab, .copyLink, .share, .reload, .stop, .back, .forward, .findInPage, .findNext, .findPrevious, .zoomIn, .zoomOut, .actualSize:
      return front.showsPage
    case .print:
      return front.showsPage && front.canPrint
    case .toggleSidebar:
      return front.canToggleSidebar
    case .nextSpace, .previousSpace:
      return front.hasSeveralSpaces
    case .newTab, .newIncognitoTab, .reopenClosedTab, .openLocation, .nextTab, .previousTab,
      .selectTab1, .selectTab2, .selectTab3, .selectTab4, .selectTab5, .selectTab6, .selectTab7, .selectTab8, .selectLastTab,
      .showHistory, .showBookmarks, .showDownloads, .settings:
      return true
    }
  }

  public static func printUnavailable(in front: CommandFront) -> Bool {
    !front.canPrint
  }
}

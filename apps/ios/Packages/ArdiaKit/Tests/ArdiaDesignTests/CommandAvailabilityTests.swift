import ArdiaDesign
import Testing

struct CommandAvailabilityTests {
  private let page = CommandFront(showsPage: true, canPrint: true, canToggleSidebar: true, hasSeveralSpaces: true)

  private let pageCommands: [BrowserCommand] = [
    .closeTab, .copyLink, .share, .print, .reload, .stop, .back, .forward,
    .findInPage, .findNext, .findPrevious, .zoomIn, .zoomOut, .actualSize,
  ]

  @Test func `with a page in front every command works`() {
    for command in BrowserCommand.allCases {
      #expect(CommandAvailability.allows(command, in: page), "\(command)")
    }
  }

  @Test func `a sheet or cover in front takes every command, so nothing acts on the tab behind it`() {
    var front = page
    front.hasModal = true
    for command in BrowserCommand.allCases {
      #expect(!CommandAvailability.allows(command, in: front), "\(command)")
    }
  }

  @Test func `while search is open, nothing switches, closes or opens under it`() {
    var front = page
    front.isSearching = true
    for command in BrowserCommand.allCases {
      #expect(!CommandAvailability.allows(command, in: front), "\(command)")
    }
  }

  @Test func `with no page on screen, page commands are off and the rest still work`() {
    var front = page
    front.showsPage = false
    for command in pageCommands {
      #expect(!CommandAvailability.allows(command, in: front), "\(command)")
    }
    for command: BrowserCommand in [.newTab, .newIncognitoTab, .reopenClosedTab, .openLocation, .nextTab, .selectTab1, .showHistory, .settings, .toggleSidebar] {
      #expect(CommandAvailability.allows(command, in: front), "\(command)")
    }
  }

  @Test func `print needs a print service, the sidebar toggle needs a sidebar, space steps need two spaces`() {
    var front = page
    front.canPrint = false
    #expect(!CommandAvailability.allows(.print, in: front))
    #expect(CommandAvailability.printUnavailable(in: front))
    #expect(!CommandAvailability.printUnavailable(in: page))
    front = page
    front.canToggleSidebar = false
    #expect(!CommandAvailability.allows(.toggleSidebar, in: front))
    front = page
    front.hasSeveralSpaces = false
    #expect(!CommandAvailability.allows(.nextSpace, in: front))
    #expect(!CommandAvailability.allows(.previousSpace, in: front))
  }
}

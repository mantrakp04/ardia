import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SidebarContext: Hashable {
  let layout: ChromeLayout
  let hinge: HingeState?

  var canToggle: Bool { SidebarVisibility.canToggle(layout: layout, hinge: hinge) }
}

extension FocusedValues {
  @Entry var sidebarContext: SidebarContext?
  @Entry var commandFront: CommandFront?
}

extension AppModel {
  func commandFront(sidebar context: SidebarContext?) -> CommandFront {
    CommandFront(
      hasModal: sheet != nil || browse.isVoicePresented || settings.isShowingOnboarding || browse.readerTabID != nil
        || web.shareRequest != nil || browse.isToolbarPresented,
      isSearching: browse.search != nil,
      showsPage: surface == .browsing && tabs.selectedTab != nil,
      canPrint: PagePrinter.isAvailable,
      canToggleSidebar: context?.canToggle ?? false,
      hasSeveralSpaces: spaces.count > 1
    )
  }
}

struct CommandFrontPublisher: ViewModifier {
  @Environment(AppModel.self) private var app

  func body(content: Content) -> some View {
    content.focusedSceneValue(\.commandFront, app.commandFront(sidebar: nil))
  }
}

extension SidebarToggleAction {
  var title: String {
    switch self {
    case .show: String(localized: "Show Sidebar")
    case .hide: String(localized: "Hide Sidebar")
    case .pin: String(localized: "Keep Sidebar Open")
    }
  }
}

enum PrintTitle {
  static func title(in front: CommandFront) -> String {
    CommandAvailability.printUnavailable(in: front)
      ? String(localized: "Can’t Print on This \(ThisDevice.current.noun)")
      : BrowserCommand.print.title
  }
}

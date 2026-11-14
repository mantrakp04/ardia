import ArdiaBrowser
import ArdiaDesign
import Foundation

@MainActor
struct CommandPerformer {
  let app: AppModel
  let sidebar: SidebarState
  let context: SidebarContext?

  private var page: WebTab? { app.currentPage }

  var front: CommandFront { app.commandFront(sidebar: context) }

  func allows(_ command: BrowserCommand) -> Bool {
    CommandAvailability.allows(command, in: front)
  }

  func perform(_ command: BrowserCommand) {
    guard allows(command) else { return }
    switch command {
    case .newTab: app.newTab()
    case .newIncognitoTab: app.newIncognitoTab()
    case .reopenClosedTab: app.reopenLastClosed()
    case .closeTab: app.closeCurrentTab()
    case .openLocation: app.editCurrentAddress()
    case .copyLink: if let tab = app.tabs.selectedTab { app.copyLink(of: tab) }
    case .share: app.shareCurrentPage()
    case .print: if PagePrinter.isAvailable { app.printCurrentPage() }
    case .reload: page?.reload()
    case .stop: page?.stopLoading()
    case .back: if page?.canGoBack == true { page?.goBack() }
    case .forward: if page?.canGoForward == true { page?.goForward() }
    case .findInPage: page?.presentFindInPage()
    case .findNext: page?.webView?.findInteraction?.findNext()
    case .findPrevious: page?.webView?.findInteraction?.findPrevious()
    case .zoomIn: page?.zoomIn()
    case .zoomOut: page?.zoomOut()
    case .actualSize: page?.setPageZoom(1)
    case .toggleSidebar: if let context { sidebar.toggle(layout: context.layout, hinge: context.hinge) }
    case .nextTab: app.stepSidebarTab(1)
    case .previousTab: app.stepSidebarTab(-1)
    case .selectTab1, .selectTab2, .selectTab3, .selectTab4, .selectTab5, .selectTab6, .selectTab7, .selectTab8, .selectLastTab:
      app.selectSidebarTab(command)
    case .nextSpace: app.stepSpace(1)
    case .previousSpace: app.stepSpace(-1)
    case .showHistory: app.openLibrary(.history)
    case .showBookmarks: app.openLibrary(.bookmarks)
    case .showDownloads: app.openLibrary(.downloads)
    case .settings: app.sheet = .settings
    }
  }
}

import ArdiaBrowser
import UIKit

enum PageMenuFollowUp: Equatable {
  case findOnPage
  case print
  case sheet(AppModel.Sheet)
  case siteSettings
}

extension AppModel {
  func perform(_ followUp: PageMenuFollowUp, on tabID: UUID) {
    switch followUp {
    case .findOnPage:
      web.existingWebTab(tabID)?.presentFindInPage()
    case .print:
      printPage(tabID)
    case .sheet(let sheet):
      self.sheet = sheet
    case .siteSettings:
      settings.pendingRoute = .siteSettings
      sheet = .settings
    }
  }

  func printPage(_ tabID: UUID) {
    guard let tab = tabs.tab(tabID), BrowserURL.isSyncable(tab.url), let webView = web.existingWebTab(tabID)?.webView else { return }
    let info = UIPrintInfo.printInfo()
    info.outputType = .general
    info.jobName = tab.title.isEmpty ? (BrowserURL.host(of: tab.url) ?? tab.url) : tab.title
    let controller = UIPrintInteractionController.shared
    controller.printInfo = info
    controller.printFormatter = webView.viewPrintFormatter()
    controller.present(animated: true)
  }
}

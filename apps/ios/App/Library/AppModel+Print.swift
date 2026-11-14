import ArdiaBrowser
import Foundation

extension AppModel {
  func printCurrentPage() {
    guard let page = currentPage else {
      announcePrint(.nothingToPrint)
      return
    }
    announcePrint(PagePrinter.print(page))
  }

  func printReader(_ content: ReadableContent) {
    announcePrint(PagePrinter.print(content))
  }

  func printReader(of tabID: UUID) async {
    guard let page = web.existingWebTab(tabID) else {
      announcePrint(.nothingToPrint)
      return
    }
    do {
      printReader(try await page.readableContent())
    } catch {
      announcePrint(.nothingToPrint)
    }
  }

  private func announcePrint(_ outcome: PrintOutcome) {
    switch outcome {
    case .presented:
      break
    case .unavailable:
      toasts.show(Toast(String(localized: "Printing Isn’t Available"), symbol: "printer"))
    case .nothingToPrint:
      toasts.show(Toast(String(localized: "Nothing to Print Yet"), symbol: "printer"))
    }
  }
}

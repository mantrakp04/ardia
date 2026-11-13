#if canImport(UIKit)
import UIKit
import WebKit

public enum PrintOutcome: Equatable, Sendable {
  case presented
  case unavailable
  case nothingToPrint
}

@MainActor
public enum PagePrinter {
  public static var isAvailable: Bool { UIPrintInteractionController.isPrintingAvailable }

  @discardableResult
  public static func print(_ page: WebTab) -> PrintOutcome {
    guard let webView = page.webView, page.url != nil, page.failure == nil else { return .nothingToPrint }
    let name = page.title.isEmpty ? (page.host ?? String(localized: "Web Page")) : page.title
    return present(webView.viewPrintFormatter(), jobName: name)
  }

  @discardableResult
  public static func print(_ content: ReadableContent) -> PrintOutcome {
    guard !content.paragraphs.isEmpty || !content.html.isEmpty else { return .nothingToPrint }
    let formatter = UIMarkupTextPrintFormatter(markupText: ReaderPrintMarkup.html(for: content))
    formatter.perPageContentInsets = UIEdgeInsets(top: 54, left: 54, bottom: 54, right: 54)
    return present(formatter, jobName: content.title)
  }

  private static func present(_ formatter: UIPrintFormatter, jobName: String) -> PrintOutcome {
    guard isAvailable else { return .unavailable }
    let info = UIPrintInfo.printInfo()
    info.outputType = .general
    info.jobName = jobName
    let controller = UIPrintInteractionController.shared
    controller.printInfo = info
    controller.printFormatter = formatter
    controller.showsNumberOfCopies = true
    return controller.present(animated: true) ? .presented : .unavailable
  }
}
#endif

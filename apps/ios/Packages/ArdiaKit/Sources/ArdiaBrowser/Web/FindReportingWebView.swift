#if canImport(UIKit)
import ObjectiveC
import UIKit
import WebKit

final class FindReportingWebView: WKWebView {
  var onFindSessionChange: ((Bool) -> Void)?

  @objc(findInteraction:didBeginFindSession:)
  func findInteractionDidBegin(_ interaction: UIFindInteraction, session: UIFindSession) {
    forwardToWebKit(#selector(findInteractionDidBegin(_:session:)), interaction, session)
    onFindSessionChange?(true)
  }

  @objc(findInteraction:didEndFindSession:)
  func findInteractionDidEnd(_ interaction: UIFindInteraction, session: UIFindSession) {
    forwardToWebKit(#selector(findInteractionDidEnd(_:session:)), interaction, session)
    onFindSessionChange?(false)
  }

  private func forwardToWebKit(_ selector: Selector, _ interaction: UIFindInteraction, _ session: UIFindSession) {
    guard let method = class_getInstanceMethod(WKWebView.self, selector) else { return }
    typealias Implementation = @convention(c) (AnyObject, Selector, UIFindInteraction, UIFindSession) -> Void
    unsafeBitCast(method_getImplementation(method), to: Implementation.self)(self, selector, interaction, session)
  }
}
#endif

import ArdiaDesign
import SwiftUI
import UIKit

final class ShareViewController: UIViewController {
  private var model: ShareSheetModel?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    let model = ShareSheetModel(
      store: SystemStore.shared,
      open: { [weak self] url in
        guard let self else { return false }
        return ContainingApp.open(url, from: self)
      },
      finish: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) },
      cancel: { [weak self] in
        self?.extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
      }
    )
    self.model = model
    let host = UIHostingController(rootView: ShareSheetView(model: model))
    host.view.backgroundColor = .clear
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
    let context = extensionContext
    Task { await model.load(from: context) }
  }
}

import AppKit
import ExpoModulesCore

final class ChromiumTabView: ExpoView, ArdiaWebViewDelegate {
  let browser = ArdiaWebView(frame: .zero)
  let onPageEvent = EventDispatcher()
  var pageEvents: Set<String> = []

  private var propsReady = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    browser.delegate = self
    wantsLayer = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    browser.frame = bounds
  }

  func propsDidUpdate() {
    guard !propsReady else { return }
    propsReady = true
    browser.frame = bounds
    addSubview(browser)
  }

  deinit {
    browser.closeBrowser()
  }

  func webView(_ view: ArdiaWebView, event name: String, payload: [String: Any]) {
    PageEvents.send(onPageEvent, wanted: pageEvents, name: name, payload: payload)
  }
}

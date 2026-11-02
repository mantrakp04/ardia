import AppKit
import ExpoModulesCore

class PageTabHost: ExpoView {
  let page: PageTab
  var pageEvents: Set<String> = []
  private var propsReady = false

  class func makePage() -> PageTab {
    preconditionFailure("\(self) doesn't say which page view it hosts")
  }

  var pageEventDispatcher: EventDispatcher {
    preconditionFailure("\(type(of: self)) declares no onPageEvent of its own, so Expo can't find it")
  }

  required init(appContext: AppContext? = nil) {
    page = Self.makePage()
    super.init(appContext: appContext)
    wantsLayer = true
  }

  deinit {
    page.closePage()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    page.frame = bounds
  }

  func propsDidUpdate() {
    guard !propsReady else { return }
    propsReady = true
    page.frame = bounds
    addSubview(page)
    page.startPage()
  }

  func send(_ name: String, payload: [String: Any]) {
    PageEvents.send(pageEventDispatcher, wanted: pageEvents, name: name, payload: payload)
  }
}

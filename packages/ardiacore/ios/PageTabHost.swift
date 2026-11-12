import AppKit
import ExpoModulesCore

class PageTabHost: ExpoView {
  let page: PageTab
  var pageEvents: Set<String> = []
  var captureOverlay: CaptureOverlay?
  var captureStarting = false
  var captureStartedAt: CFTimeInterval = 0
  var capturedPNG: Data?
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
    let resized = newSize != frame.size
    super.setFrameSize(newSize)
    page.frame = bounds
    if resized { endCapture() }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { endCapture() }
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

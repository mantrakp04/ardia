import ExpoModulesCore
import WebKit

final class MeadowView: ExpoView {
  let onTone = EventDispatcher()

  private let clip = NSView()
  private let poster = NSView()
  private var posterChoice: MeadowPoster?
  private var posterImage: CGImage?
  private var webView: WKWebView?
  private var messages: MeadowMessages?
  private var ready = false
  private var pageNight = false
  var night = false {
    didSet { if night != oldValue { nightChanged() } }
  }
  private var timeline: [String: Double] = [:]
  private let created = CACurrentMediaTime()

  private static var lastTimeline: [String: Any] = [:]
  private static let handoff: TimeInterval = 0.4

  static var debugState: [String: Any] { lastTimeline }
  static weak var live: MeadowView?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clip.wantsLayer = true
    clip.layer?.masksToBounds = true
    poster.wantsLayer = true
    poster.layer?.contentsGravity = .resize
    clip.addSubview(poster)
    addSubview(clip)
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override var acceptsFirstResponder: Bool { false }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    clip.frame = bounds
    webView?.frame = bounds
    placePoster()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { tearDown() }
    else if webView == nil { load() }
  }

  private func mark(_ event: String) {
    timeline[event] = (CACurrentMediaTime() - created) * 1000
    var state: [String: Any] = timeline
    if let pid = webView?.value(forKey: "_webProcessIdentifier") { state["webProcess"] = pid }
    Self.lastTimeline = state
  }

  private func load() {
    guard let bundle = MeadowPoster.bundle, let page = bundle.url(forResource: "index", withExtension: "html") else { return }
    let messages = MeadowMessages(view: self, page: page)
    ready = false
    pageNight = night
    poster.isHidden = night
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.add(messages, name: MeadowMessages.name)
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.preferences.isElementFullscreenEnabled = false
    config.mediaTypesRequiringUserActionForPlayback = .all
    let webView = WKWebView(frame: bounds, configuration: config)
    webView.navigationDelegate = messages
    webView.allowsMagnification = false
    webView.allowsBackForwardNavigationGestures = false
    webView.allowsLinkPreview = false
    webView.isInspectable = false
    webView.setAccessibilityElement(false)
    webView.alphaValue = 0
    addSubview(webView)
    self.webView = webView
    self.messages = messages
    Self.live = self
    timeline = [:]
    mark("created")
    let opening = URL(string: night ? "#night" : "#day", relativeTo: page)?.absoluteURL ?? page
    webView.loadFileURL(opening, allowingReadAccessTo: bundle.bundleURL)
    placePoster()
  }

  func evaluate(_ script: String, _ done: @escaping (Any?) -> Void) {
    guard let webView else { return done(nil) }
    webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let value): done(value)
      case .failure(let error): done(["error": error.localizedDescription])
      }
    }
  }

  private func tearDown() {
    guard let webView else { return }
    webView.configuration.userContentController.removeScriptMessageHandler(forName: MeadowMessages.name)
    webView.navigationDelegate = nil
    webView.stopLoading()
    webView.removeFromSuperview()
    self.webView = nil
    messages = nil
    mark("tornDown")
  }

  private func nightChanged() {
    if !ready {
      poster.isHidden = night
      placePoster()
    }
    sendNight()
  }

  private func sendNight() {
    guard ready, pageNight != night, let webView else { return }
    pageNight = night
    webView.evaluateJavaScript("meadowNight(\(night))")
  }

  private func placePoster() {
    guard webView != nil, !(ready ? pageNight : night), bounds.width > 0, bounds.height > 0 else { return }
    if posterChoice == nil, let choice = MeadowPoster.nearest(aspect: bounds.width / bounds.height, reduceMotion: WindowActivity.reduceMotion) {
      posterChoice = choice
      choice.decode { [weak self] image in
        guard let self, let image else { return }
        posterImage = image
        poster.layer?.contents = image
        mark("poster")
        placePoster()
      }
    }
    guard let posterChoice, let posterImage else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    poster.frame = posterChoice.frame(for: posterImage, in: bounds.size, flipped: clip.isFlipped)
    CATransaction.commit()
  }

  func pageSaid(_ state: String, _ body: [String: Any]) {
    switch state {
    case "ready":
      guard !ready, let webView else { return }
      ready = true
      mark("firstFrame")
      sendNight()
      NSAnimationContext.runAnimationGroup({ context in
        context.duration = Self.handoff
        context.timingFunction = CAMediaTimingFunction(controlPoints: 0.37, 0, 0.63, 1)
        webView.animator().alphaValue = 1
      }, completionHandler: { [weak self] in
        self?.poster.isHidden = true
      })
    case "tone":
      guard let tone = body["tone"] as? String else { return }
      onTone(["tone": tone, "halo": (body["halo"] as? Double) ?? 0])
    case "failed":
      mark("failed")
    default:
      break
    }
  }
}

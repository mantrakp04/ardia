import AppKit
import WebKit

protocol WebKitTabDelegate: AnyObject {
  func webKitTab(_ tab: WebKitTab, event name: String, payload: [String: Any])
}

final class WebKitTab: NSView, WKNavigationDelegate, WKUIDelegate {
  static let zoomLevels: [Double] = [0.25, 0.333, 0.5, 0.667, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

  weak var delegate: WebKitTabDelegate?
  var profile = ""
  var initialURL: String?
  var adoptId: String?
  var transferKey: String?
  var visible = true { didSet { updateHidden() } }
  var warm = false { didSet { updateHidden() } }
  var pageBackgroundColor: NSColor? { didSet { if let color = pageBackgroundColor { webView?.underPageBackgroundColor = color } } }
  let browserId = WebKitHub.shared.nextBrowserId()

  private(set) var webView: WebKitWebView?
  private var observations: [NSKeyValueObservation] = []
  private var started = false
  private var closed = false
  private var navigationQueued = false
  private var mediaFrames: [String: WKFrameInfo] {
    get { webView?.mediaFrames ?? [:] }
    set { webView?.mediaFrames = newValue }
  }
  private var playingFrames: Set<String> {
    get { webView?.playingFrames ?? [] }
    set { webView?.playingFrames = newValue }
  }
  private var muted = false
  private var errorURL: URL?
  private var showingError = false
  private var findText = ""
  private var findCount = 0
  private var findActive = 0

  override var isFlipped: Bool { true }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    webView?.frame = bounds
  }

  private func emit(_ name: String, _ payload: [String: Any] = [:]) {
    delegate?.webKitTab(self, event: name, payload: payload)
  }

  func start() {
    guard !started else { return }
    started = true
    begin()
  }

  private func begin() {
    guard !closed else { return }
    if let key = transferKey {
      let handedOver = WebKitHub.shared.transfers.isPrepared(key) ? WebKitHub.shared.transfers.liveTab(key).flatMap { $0 === self ? nil : $0.relinquish() } : nil
      let parked = WebKitHub.shared.transfers.claimParked(key) as? WebKitWebView
      WebKitHub.shared.transfers.noteLive(self, key: key)
      if let view = handedOver ?? parked {
        if let parked, parked !== view { WebKitHub.close(parked) }
        attach(view)
        emitEverything()
        return
      }
    }
    if let id = adoptId, id.hasPrefix("webkit:"), let offered = WebKitHub.shared.transfers.claimOffered(id) as? WebKitWebView {
      attach(offered)
      emitEverything()
      return
    }
    let created = WebKitWebView(frame: bounds, configuration: WebKitHub.shared.configuration(profile: profile))
    attach(created)
    emit("ready", [:])
    if let url = initialURL, !url.isEmpty { loadURL(url, userInitiated: false) }
  }

  func relinquish() -> WebKitWebView? {
    guard !closed, let view = webView else { return nil }
    closed = true
    observations = []
    WebKitHub.shared.permissions.drop(browserId: browserId)
    if let key = transferKey { WebKitHub.shared.transfers.forgetLive(self, key: key) }
    webView = nil
    view.onFocus = nil
    WebKitHub.shared.transfers.unregister(view)
    view.navigationDelegate = nil
    view.uiDelegate = nil
    view.removeFromSuperview()
    return view
  }

  private func emitEverything() {
    emit("ready", [:])
    queueNavigation()
    emit("progress", ["progress": webView?.estimatedProgress ?? 0])
    emitSecurity()
    emitZoom()
  }

  private func attach(_ view: WebKitWebView) {
    webView = view
    WebKitHub.shared.transfers.register(view, tab: self)
    view.navigationDelegate = self
    view.uiDelegate = self
    view.allowsBackForwardNavigationGestures = true
    view.allowsMagnification = true
    view.isInspectable = WebKitHub.inspectable && !WebKitStores.isPrivate(profile)
    if let color = pageBackgroundColor { view.underPageBackgroundColor = color }
    view.onFocus = { [weak self] in self?.emit("focus") }
    view.frame = bounds
    view.autoresizingMask = [.width, .height]
    addSubview(view)
    updateHidden()
    observe(view)
    WebKitHub.shared.permissions.reconcileCapture(view, profile: profile)
  }

  private func observe(_ view: WKWebView) {
    let navigation: (WKWebView) -> Void = { [weak self] _ in self?.queueNavigation() }
    observations = [
      view.observe(\.url) { _, _ in navigation(view) },
      view.observe(\.title) { _, _ in navigation(view) },
      view.observe(\.canGoBack) { _, _ in navigation(view) },
      view.observe(\.canGoForward) { _, _ in navigation(view) },
      view.observe(\.isLoading) { _, _ in navigation(view) },
      view.observe(\.themeColor) { _, _ in navigation(view) },
      view.observe(\.estimatedProgress) { [weak self] v, _ in self?.emit("progress", ["progress": v.estimatedProgress]) },
      view.observe(\.hasOnlySecureContent) { [weak self] _, _ in self?.emitSecurity() },
      view.observe(\.serverTrust) { [weak self] _, _ in self?.emitSecurity() },
      view.observe(\.cameraCaptureState) { [weak self] _, _ in self?.emitMediaAccess() },
      view.observe(\.microphoneCaptureState) { [weak self] _, _ in self?.emitMediaAccess() },
      view.observe(\.magnification) { [weak self] _, _ in self?.emitZoom() },
    ]
  }

  private func updateHidden() {
    webView?.isHidden = !(visible || warm)
  }

  func close() {
    guard !closed else { return }
    closed = true
    observations = []
    WebKitHub.shared.permissions.drop(browserId: browserId)
    if let key = transferKey { WebKitHub.shared.transfers.forgetLive(self, key: key) }
    guard let view = webView else { return }
    webView = nil
    view.onFocus = nil
    if let key = transferKey, WebKitHub.shared.transfers.isPrepared(key) {
      WebKitHub.shared.transfers.unregister(view)
      view.navigationDelegate = nil
      view.uiDelegate = nil
      view.removeFromSuperview()
      if WebKitHub.shared.transfers.park(view, key: key) { return }
    }
    WebKitHub.close(view)
  }

  private func queueNavigation() {
    guard !navigationQueued else { return }
    navigationQueued = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.navigationQueued = false
      self.emitNavigation()
    }
  }

  private func emitNavigation() {
    guard let view = webView else { return }
    let theme = view.themeColor.flatMap(Self.hex)
    emit("navigation", [
      "url": view.url?.absoluteString ?? "",
      "committedUrl": showingError ? "" : (view.backForwardList.currentItem?.url.absoluteString ?? ""),
      "title": showingError ? "Can't Open This Page" : (view.title ?? ""),
      "canGoBack": view.canGoBack,
      "canGoForward": view.canGoForward,
      "isLoading": view.isLoading,
      "themeColor": theme ?? NSNull(),
      "themeColorSource": theme == nil ? NSNull() : "meta",
    ])
  }

  static func hex(_ color: NSColor) -> String? {
    guard let rgb = color.usingColorSpace(.sRGB) else { return nil }
    let r = Int((rgb.redComponent * 255).rounded()), g = Int((rgb.greenComponent * 255).rounded()), b = Int((rgb.blueComponent * 255).rounded())
    return String(format: "#%02X%02X%02X", max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
  }

  private func emitMediaAccess() {
    guard let view = webView else { return }
    emit("mediaAccess", [
      "camera": view.cameraCaptureState == .active, "microphone": view.microphoneCaptureState == .active, "screen": false,
    ])
  }

  func loadURL(_ url: String, userInitiated: Bool) {
    guard let view = webView, let target = URL(string: url) else { return }
    showingError = false
    if target.isFileURL {
      view.loadFileURL(target, allowingReadAccessTo: target.deletingLastPathComponent())
    } else {
      view.load(URLRequest(url: target))
    }
  }

  func goBack() { webView?.goBack() }
  func goForward() { webView?.goForward() }

  func go(toHistoryOffset offset: Int) {
    guard let view = webView, let item = view.backForwardList.item(at: offset) else { return }
    view.go(to: item)
  }

  func reload() {
    if showingError, let url = errorURL { return loadURL(url.absoluteString, userInitiated: true) }
    webView?.reload()
  }

  func reloadIgnoringCache() {
    if showingError, let url = errorURL { return loadURL(url.absoluteString, userInitiated: true) }
    webView?.reloadFromOrigin()
  }

  func stopLoading() { webView?.stopLoading() }

  func focusPage() {
    guard let view = webView else { return }
    window?.makeFirstResponder(view)
  }

  func setMuted(_ on: Bool) {
    muted = on
    let code = muteScript
    runInWorld(code)
    for frame in mediaFrames.values where !frame.isMainFrame { runInWorld(code, frame: frame) }
  }

  private var muteScript: String { "window.__ardia && window.__ardia.mute(\(muted ? "true" : "false"))" }


  private func runInWorld(_ code: String, frame: WKFrameInfo? = nil, completion: ((Any?) -> Void)? = nil) {
    guard let view = webView else {
      completion?(nil)
      return
    }
    view.evaluateJavaScript(code, in: frame, in: WebKitHub.world) { result in
      if case .success(let value) = result { completion?(value) } else { completion?(nil) }
    }
  }

  private var host: String { webView?.url?.host?.lowercased() ?? "" }

  func zoomStep(_ direction: Int) {
    guard let view = webView else { return }
    let current = view.pageZoom
    var next = 1.0
    if direction > 0 { next = Self.zoomLevels.first { $0 > current + 0.001 } ?? current }
    if direction < 0 { next = Self.zoomLevels.last { $0 < current - 0.001 } ?? current }
    view.pageZoom = next
    if !host.isEmpty { WebKitHub.shared.stores.setZoom(next, profile: profile, host: host) }
    emitZoom(byUser: abs(next - current) > 0.001)
  }

  private func emitZoom(byUser user: Bool = false) {
    guard let view = webView else { return }
    emit("zoom", ["zoom": view.pageZoom, "host": host, "isDefault": abs(view.pageZoom - 1) < 0.001, "pinchScale": view.magnification, "user": user])
  }

  func find(_ text: String, forward: Bool, findNext: Bool) {
    guard let view = webView else { return }
    if text.isEmpty {
      findText = ""
      return emit("find", ["count": 0, "active": 0, "final": true])
    }
    let fresh = text != findText
    findText = text
    let configuration = WKFindConfiguration()
    configuration.backwards = !forward
    configuration.caseSensitive = false
    configuration.wraps = true
    let quoted = Self.jsString(text)
    runInWorld("window.__ardia ? window.__ardia.count(\(quoted)) : 0") { [weak self] value in
      guard let self, self.findText == text else { return }
      self.findCount = (value as? NSNumber)?.intValue ?? 0
      view.find(text, configuration: configuration) { [weak self] result in
        guard let self, self.findText == text else { return }
        if !result.matchFound {
          self.findActive = 0
        } else if fresh || self.findActive == 0 {
          self.findActive = 1
        } else if findNext && self.findCount > 0 {
          self.findActive = forward ? self.findActive % self.findCount + 1 : (self.findActive + self.findCount - 2) % self.findCount + 1
        }
        let count = result.matchFound ? max(self.findCount, 1) : 0
        self.emit("find", ["count": count, "active": min(self.findActive, count), "final": true])
      }
    }
  }

  func stopFinding(_ clearSelection: Bool) {
    findText = ""
    findActive = 0
    if clearSelection { runInWorld("getSelection().removeAllRanges()") }
  }

  static func jsString(_ text: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [text]), let json = String(data: data, encoding: .utf8) else { return "\"\"" }
    return String(json.dropFirst().dropLast())
  }

  func print() {
    guard let view = webView, let window else { return }
    if LaunchConfig.shared.background { return NSLog("[webkit] print panel (background mode, not shown)") }
    let operation = view.printOperation(with: NSPrintInfo.shared)
    operation.view?.frame = view.bounds
    operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
  }

  func runPageCommand(_ name: String) {
    if name == "systemPrint" { print() }
  }

  func executeJavaScript(_ code: String) {
    webView?.evaluateJavaScript(code, in: nil, in: .page) { _ in }
  }

  func evaluate(_ code: String, completion: @escaping (String?) -> Void) {
    guard let view = webView else { return completion(nil) }
    let body = "return await new Promise((resolve) => { const post = (kind, json) => { if (kind === \"result\") resolve(json); }; setTimeout(() => resolve(null), 3000); try {\n\(code)\n} catch (e) { resolve(null); } });"
    view.callAsyncJavaScript(body, arguments: [:], in: nil, in: WebKitHub.world) { result in
      if case .success(let value) = result { completion(value as? String) } else { completion(nil) }
    }
  }

  func capturePicture(_ scale: Double, completion: @escaping ([String: Any]?) -> Void) {
    guard let view = webView, let window, !view.isHidden else { return completion(nil) }
    let inWindow = convert(bounds, to: nil)
    let top = window.contentView?.frame.height ?? 0
    let frame: [Double] = [inWindow.minX, top - inWindow.maxY, inWindow.width, inWindow.height]
    let configuration = WKSnapshotConfiguration()
    configuration.snapshotWidth = NSNumber(value: Double(view.bounds.width) * max(0.1, min(scale, 2)))
    view.takeSnapshot(with: configuration) { image, _ in
      guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
        let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: scale < 0.5 ? 0.55 : 0.75])
      else { return completion(nil) }
      completion(["data": jpeg.base64EncodedString(), "frame": frame])
    }
  }

  func navigationEntries() -> [[String: Any]] {
    guard let list = webView?.backForwardList else { return [] }
    let entry = { (item: WKBackForwardListItem, current: Bool) -> [String: Any] in
      ["url": item.url.absoluteString, "title": item.title ?? "", "current": current]
    }
    var entries = list.backList.map { entry($0, false) }
    if let current = list.currentItem { entries.append(entry(current, true)) }
    entries += list.forwardList.map { entry($0, false) }
    return entries
  }

  func downloadFavicon(_ url: String, completion: @escaping ([String: Any]?) -> Void) {
    ArdiaFavicons.fetch(url, profile: profile, name: nil) { completion($0) }
  }

  func mediaCommand(_ action: String, seconds: Double) {
    let frame = webView?.nowPlaying.frame.flatMap { mediaFrames[$0] }
    runInWorld("window.__ardia && window.__ardia.media(\(Self.jsString(action)), \(seconds.isFinite ? seconds : 0))", frame: frame?.isMainFrame == true ? nil : frame)
  }

  func setPictureInPicture(_ on: Bool, completion: @escaping (Bool) -> Void) {
    runInWorld("window.__ardia ? window.__ardia.pictureInPicture(\(on ? "true" : "false")) : false") { value in
      completion((value as? NSNumber)?.boolValue ?? false)
    }
  }

  func securityInfo() -> [String: Any] {
    guard let view = webView, let url = view.url, !showingError else {
      return ["level": "none", "url": webView?.url?.absoluteString ?? "", "origin": NSNull()]
    }
    let scheme = url.scheme?.lowercased() ?? ""
    let origin = scheme == "http" || scheme == "https" ? Origins.of(url) : nil
    var info: [String: Any] = ["url": url.absoluteString, "origin": origin ?? NSNull()]
    switch scheme {
    case "https":
      info["level"] = view.hasOnlySecureContent ? "secure" : "mixed"
      if let trust = view.serverTrust, let certificate = Self.certificate(trust) { info["certificate"] = certificate }
    case "http": info["level"] = "insecure"
    case "file": info["level"] = "local"
    default: info["level"] = "none"
    }
    return info
  }

  private func emitSecurity() {
    guard webView != nil else { return }
    emit("security", securityInfo())
  }

  func clearSiteData(_ reply: @escaping (Any?, String?) -> Void) {
    guard !host.isEmpty else { return reply(["cookies": false, "storage": false], nil) }
    WebKitHub.shared.clearSiteData(profile: profile, host: host) { reply($0, nil) }
  }

  func pageMessage(_ kind: String, data: Any?, frame: String, frameInfo: WKFrameInfo) {
    let dict = data as? [String: Any]
    let main = frameInfo.isMainFrame
    switch kind {
    case "media":
      guard let dict else { return }
      mediaFrames[frame] = frameInfo
      if (dict["muted"] as? Bool ?? false) != muted { runInWorld(muteScript, frame: main ? nil : frameInfo) }
      if dict["playing"] as? Bool == true { playingFrames.insert(frame) } else { playingFrames.remove(frame) }
      emit("media", ["playing": !playingFrames.isEmpty, "muted": muted])
    case "nowPlaying":
      guard let view = webView else { return }
      if let dict, !dict.isEmpty { mediaFrames[frame] = frameInfo }
      emit("nowPlaying", ["state": view.nowPlaying.noteFrame(frame, page: data, main: main) ?? NSNull()])
    case "pip":
      emit("pictureInPicture", ["kind": "video", "active": dict?["active"] as? Bool ?? false])
    case "status":
      emit("status", ["text": data as? String ?? ""])
    case "icons":
      guard main, let urls = dict?["urls"] as? [String], let first = urls.first else { return }
      emit("favicon", ["url": first, "urls": urls])
    case "scroll":
      guard main, let state = dict?["state"] as? String, ["down", "up", "top"].contains(state) else { return }
      emit("scroll", ["state": state])
    default: break
    }
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.allow) }
    let scheme = url.scheme?.lowercased() ?? ""
    let webSchemes: Set<String> = ["http", "https", "file", "about", "data", "blob", "javascript", "webkit-pdfjs-viewer"]
    if !webSchemes.contains(scheme) {
      decisionHandler(.cancel)
      let fromMainFrame = action.sourceFrame.isMainFrame || action.targetFrame?.isMainFrame == true
      guard action.navigationType == .linkActivated || fromMainFrame else { return }
      let source = action.sourceFrame.securityOrigin
      let origin = source.host.isEmpty ? nil : Origins.of(source)
      if let request = WebKitHub.shared.externalApps.request(url: url, origin: origin, profile: profile) { emit("externalApp", request) }
      return
    }
    if action.navigationType == .linkActivated, action.targetFrame != nil {
      let flags = action.modifierFlags
      if flags.contains(.command) || action.buttonNumber == 2 {
        decisionHandler(.cancel)
        let disposition = flags.contains(.shift) ? "foreground" : "background"
        return emit("openWindow", ["url": url.absoluteString, "disposition": disposition, "userGesture": true])
      }
      if flags.contains(.option) { return decisionHandler(.download) }
    }
    decisionHandler(action.shouldPerformDownload ? .download : .allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
    let attachment = disposition.hasPrefix("attachment")
    decisionHandler(!response.canShowMIMEType || (attachment && response.isForMainFrame) ? .download : .allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    adoptDownload(download, from: webView)
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    adoptDownload(download, from: webView)
  }

  private func adoptDownload(_ download: WKDownload, from webView: WKWebView) {
    WebKitHub.shared.downloads.adopt(download, profile: profile, webView: webView)
    let url = download.originalRequest?.url?.absoluteString ?? ""
    emit("downloadNavigation", ["url": url, "committedUrl": webView.backForwardList.currentItem?.url.absoluteString ?? "", "skipped": false])
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    if !showingError { errorURL = nil }
    playingFrames.removeAll()
    mediaFrames.removeAll()
    resetNowPlaying()
    self.webView?.captureOrigins.removeAll()
    if !host.isEmpty {
      let zoom = WebKitHub.shared.stores.zoom(profile: profile, host: host)
      if abs(webView.pageZoom - zoom) > 0.001 { webView.pageZoom = zoom }
    }
    if muted { setMuted(true) }
    emitZoom()
    emitSecurity()
    queueNavigation()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if muted { setMuted(true) }
    queueNavigation()
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if showingError && webView.url != errorURL { showingError = false }
    emit("status", ["text": ""])
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failed(webView, error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(webView, error)
  }

  private func failed(_ webView: WKWebView, _ error: Error) {
    let nsError = error as NSError
    if nsError.code == NSURLErrorCancelled || (nsError.domain == "WebKitErrorDomain" && (nsError.code == 102 || nsError.code == 204)) {
      return queueNavigation()
    }
    let failing = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
    emit("loadError", ["url": failing?.absoluteString ?? "", "code": nsError.code, "text": nsError.localizedDescription])
    guard let failing else { return queueNavigation() }
    errorURL = failing
    showingError = true
    webView.loadHTMLString(Self.errorPage(failing, nsError), baseURL: failing)
  }

  static func errorPage(_ url: URL, _ error: NSError) -> String {
    let escape = { (text: String) in
      text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }
    return """
      <!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Can't Open This Page</title>
      <style>body{font:13px -apple-system,system-ui;display:flex;align-items:center;justify-content:center;height:90vh;margin:0;color:#555}
      @media (prefers-color-scheme: dark){body{color:#bbb;background:#1e1e1e}}main{max-width:460px;text-align:center}
      h1{font-size:20px;font-weight:600;color:CanvasText;margin:0 0 8px}p{margin:4px 0;word-break:break-word}</style></head>
      <body><main><h1>Can't open this page</h1><p>\(escape(url.host ?? url.absoluteString))</p><p>\(escape(error.localizedDescription))</p></main></body></html>
      """
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    mediaFrames.removeAll()
    resetNowPlaying()
    emit("crashed", ["status": 0, "reason": "crashed", "code": 0])
  }

  private func resetNowPlaying() {
    if webView?.nowPlaying.reset() == true { emit("nowPlaying", ["state": NSNull()]) }
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
               windowFeatures: WKWindowFeatures) -> WKWebView? {
    let child = WebKitWebView(frame: .zero, configuration: configuration)
    let id = WebKitHub.shared.transfers.offer(child)
    let flags = action.modifierFlags
    let popup = windowFeatures.width != nil || windowFeatures.height != nil
    let disposition = flags.contains(.command) || action.buttonNumber == 2 ? (flags.contains(.shift) ? "foreground" : "background") : popup ? "popup" : "foreground"
    emit("openWindow", ["url": action.request.url?.absoluteString ?? "", "disposition": disposition, "adoptId": id, "userGesture": true])
    return child
  }

  func webViewDidClose(_ webView: WKWebView) {
    emit("windowClose")
  }
}

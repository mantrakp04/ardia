import AppKit
import WebKit

final class WebKitWebView: WKWebView {
  var onFocus: (() -> Void)?
  var mediaFrames: [String: WKFrameInfo] = [:]
  var playingFrames = Set<String>()
  let nowPlaying = ArdiaNowPlaying()
  var captureOrigins: [String: Set<String>] = [:]
  var autoPictureInPictureRule = WebKitAutoPictureInPicture()
  private var keyUpOfReservedKey: UInt16?

  override init(frame: CGRect, configuration: WKWebViewConfiguration) {
    super.init(frame: frame, configuration: configuration)
    if WebKitHub.silenced { mutePageAudio() }
    if LaunchConfig.shared.background && !LaunchConfig.shared.instanceFlag("allowOcclusion") { treatWindowAsVisible() }
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
  }

  private func mutePageAudio() {
    let setPageMuted = NSSelectorFromString("_setPageMuted:")
    guard responds(to: setPageMuted) else { return NSLog("[webkit] page audio can't be muted in background mode") }
    typealias SetPageMuted = @convention(c) (AnyObject, Selector, UInt) -> Void
    let audioMuted: UInt = 1
    unsafeBitCast(method(for: setPageMuted), to: SetPageMuted.self)(self, setPageMuted, audioMuted)
  }

  private func treatWindowAsVisible() {
    let setDetection = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
    guard responds(to: setDetection) else { return NSLog("[webkit] window occlusion can't be ignored in background mode") }
    typealias SetDetection = @convention(c) (AnyObject, Selector, Bool) -> Void
    unsafeBitCast(method(for: setDetection), to: SetDetection.self)(self, setDetection, false)
  }

  func stopCapture(_ kind: String) {
    if kind == "camera" { setCameraCaptureState(.none, completionHandler: {}) }
    if kind == "microphone" { setMicrophoneCaptureState(.none, completionHandler: {}) }
  }

  override func becomeFirstResponder() -> Bool {
    let became = super.becomeFirstResponder()
    if became { onFocus?() }
    return became
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard (window?.firstResponder as? NSView)?.isDescendant(of: self) == true else { return super.performKeyEquivalent(with: event) }
    let reserved = ArdiaPerformReservedKey(event)
    keyUpOfReservedKey = reserved ? event.keyCode : nil
    return reserved || super.performKeyEquivalent(with: event)
  }

  override func keyDown(with event: NSEvent) {
    keyUpOfReservedKey = nil
    super.keyDown(with: event)
  }

  override func keyUp(with event: NSEvent) {
    if keyUpOfReservedKey == event.keyCode {
      keyUpOfReservedKey = nil
      return
    }
    super.keyUp(with: event)
  }

  override func resignFirstResponder() -> Bool {
    keyUpOfReservedKey = nil
    return super.resignFirstResponder()
  }

  override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
    super.willOpenMenu(menu, with: event)
    if LaunchConfig.shared.background {
      NSLog("[webkit] context menu (background mode, not shown): %@", menu.items.map(\.title).joined(separator: ", "))
      menu.removeAllItems()
      return
    }
    let renames = [
      "WKMenuItemIdentifierOpenLinkInNewWindow": "Open Link in New Tab",
      "WKMenuItemIdentifierOpenImageInNewWindow": "Open Image in New Tab",
      "WKMenuItemIdentifierOpenMediaInNewWindow": "Open Video in New Tab",
      "WKMenuItemIdentifierOpenFrameInNewWindow": "Open Frame in New Tab",
    ]
    for item in menu.items {
      if let id = item.identifier?.rawValue, let title = renames[id] { item.title = title }
    }
  }
}

import AppKit
import Carbon.HIToolbox

enum Refusal: String {
  case deadline
  case cancelled
  case superseded
  case staleEpoch = "stale_epoch"
  case queueFull = "queue_full"
  case noOrigin = "no_origin"
  case lateAcknowledgement = "late_acknowledgement"
  case focusLost = "focus_lost"
  case mouseDown = "mouse_down"
  case windowLeft = "window_left"
  case noText = "no_text"
  case deferred
  case refused
}

enum PasteRefusal {
  static let pasteboardTextMissing = Notification.Name("ArdiaPasteboardTextMissing")

  private static let sessionLimit = 50
  private static let typeLimit = 24
  private static let pasteActions: Set<Selector> = [#selector(NSText.paste(_:)), Selector(("pasteAndMatchStyle:"))]
  private static var installed = false
  private static var reported = 0
  private static var reportedResponder = false

  static func install() {
    guard !installed else { return }
    installed = true
    NotificationCenter.default.addObserver(forName: pasteboardTextMissing, object: nil, queue: .main) { note in
      let offered = note.userInfo?["types"] as? [String] ?? []
      report(.noText, ["types": Array(offered.prefix(typeLimit))])
    }
  }

  static func reportMenuPaste(_ action: Selector, _ reason: Refusal) {
    guard pasteActions.contains(action) else { return }
    let responder = NSApp.keyWindow?.firstResponder
    if reason == .refused, !MainMenu.editsText(responder) { return }
    guard !reportedResponder else { return report(reason) }
    reportedResponder = true
    report(reason, ["responder": responder.map { String(describing: type(of: $0)) } ?? "nil"])
  }

  static func report(_ reason: Refusal, _ details: [String: Any] = [:]) {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { report(reason, details) }
      return
    }
    guard reported < sessionLimit else { return }
    reported += 1
    var body = details
    body["type"] = "pasteRefused"
    body["reason"] = reason.rawValue
    body["gateOpen"] = FocusHandoff.shared.gatesKeyWindow
    if let layout = keyboardLayoutID { body["layout"] = layout }
    ShellEvents.send(.app, body)
  }

  private static var keyboardLayoutID: String? {
    guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
      let property = TISGetInputSourceProperty(source, kTISPropertyInputSourceID)
    else { return nil }
    return Unmanaged<CFString>.fromOpaque(property).takeUnretainedValue() as String
  }
}

import AppKit

extension WebKitTab: PageTab {
  static let unsupported = "unsupported"

  var standalone: Bool { get { false } set {} }
  var temporary: Bool { get { false } set {} }
  var temporarySource: String? { get { nil } set {} }
  var extensionHost: String? { get { nil } set {} }
  var neighbour: Bool { get { false } set {} }
  var pageColor: String? { get { nil } set {} }
  var contentsBackgroundColor: NSColor? { get { nil } set {} }
  var shownURL: String? { get { nil } set {} }
  var autoPictureInPicture: Bool { get { false } set {} }
  var frozen: Bool { get { false } set {} }
  var mediaCaptureSourceId: String? { nil }

  func startPage() { start() }

  func closePage() {
    if Thread.isMainThread { return close() }
    DispatchQueue.main.async { self.close() }
  }

  func navigationEntries(_ completion: @escaping ([[String: Any]]) -> Void) { completion(navigationEntries()) }

  func securityInfo(_ completion: @escaping ([String: Any]) -> Void) { completion(securityInfo()) }

  func showDevTools(panel: String?) {}

  func downloadImage(_ url: String, maxPixels: Int, completion: @escaping ([String: Any]?) -> Void) {
    downloadFavicon(url, completion: completion)
  }

  func requestPictureInPicture(clickAt: Double, control: Int, _ completion: @escaping (Bool) -> Void) {
    setPictureInPicture(true, completion: completion)
  }

  func takeControlPress(clickAt: Double, control: Int) -> Bool { true }

  func exitPictureInPicture() { setPictureInPicture(false) { _ in } }

  func pageCookies(_ urls: [String], completion: @escaping ([[String: Any]]?) -> Void) { completion([]) }

  func openBlockedPopup(_ popupId: String, always: Bool) {}

  func resolvePasswordPrompt(_ action: String, username: String?, password: String?) {}

  func resolveAutofillPrompt(_ promptId: Int, action: String) {}

  func executeExtensionAction(_ extensionId: String) -> String? { nil }

  func resolveDisplayMedia(_ requestId: String, sourceId: String?, audio: Bool) {}

  func notificationAction(_ notificationId: String, action: String) {}

  func resolveUnresponsive(terminate: Bool) {}

  func discard(unload: Bool) -> String { Self.unsupported }
}

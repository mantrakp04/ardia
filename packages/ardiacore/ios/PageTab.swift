import AppKit

protocol PageTab: NSView {
  var initialURL: String? { get set }
  var profile: String { get set }
  var adoptId: String? { get set }
  var transferKey: String? { get set }
  var standalone: Bool { get set }
  var temporary: Bool { get set }
  var temporarySource: String? { get set }
  var extensionHost: String? { get set }
  var visible: Bool { get set }
  var warm: Bool { get set }
  var neighbour: Bool { get set }
  var pageBackgroundColor: NSColor? { get set }
  var pageColor: String? { get set }
  var contentsBackgroundColor: NSColor? { get set }
  var shownURL: String? { get set }
  var autoPictureInPicture: Bool { get set }
  var frozen: Bool { get set }
  var mediaCaptureSourceId: String? { get }

  func startPage()
  func closePage()

  func loadURL(_ url: String, userInitiated: Bool)
  func goBack()
  func goForward()
  func go(toHistoryOffset offset: Int)
  func reload()
  func reloadIgnoringCache()
  func stopLoading()
  func focusPage()
  func setMuted(_ muted: Bool)
  func zoomStep(_ direction: Int)
  func find(_ text: String, forward: Bool, findNext: Bool)
  func stopFinding(_ clearSelection: Bool)
  func print()
  func runPageCommand(_ name: String)
  func showDevTools(panel: String?)
  func executeJavaScript(_ code: String)
  func evaluate(_ code: String, completion: @escaping (String?) -> Void)
  func navigationEntries(_ completion: @escaping ([[String: Any]]) -> Void)
  func capturePicture(_ scale: Double, completion: @escaping ([String: Any]?) -> Void)
  func downloadFavicon(_ url: String, completion: @escaping ([String: Any]?) -> Void)
  func downloadImage(_ url: String, maxPixels: Int, completion: @escaping ([String: Any]?) -> Void)

  func mediaCommand(_ action: String, seconds: Double)
  func requestPictureInPicture(clickAt: Double, control: Int, _ completion: @escaping (Bool) -> Void)
  func takeControlPress(clickAt: Double, control: Int) -> Bool
  func exitPictureInPicture()

  func securityInfo(_ completion: @escaping ([String: Any]) -> Void)
  func pageCookies(_ urls: [String], completion: @escaping ([[String: Any]]?) -> Void)
  func openBlockedPopup(_ popupId: String, always: Bool)
  func clearSiteData(_ reply: @escaping (Any?, String?) -> Void)

  func resolvePasswordPrompt(_ action: String, username: String?, password: String?)
  func resolveAutofillPrompt(_ promptId: Int, action: String)
  func executeExtensionAction(_ extensionId: String) -> String?
  func resolveDisplayMedia(_ requestId: String, sourceId: String?, audio: Bool)
  func notificationAction(_ notificationId: String, action: String)
  func resolveUnresponsive(terminate: Bool)
  func discard(unload: Bool) -> String
}

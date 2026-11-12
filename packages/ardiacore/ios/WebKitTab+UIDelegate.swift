import AppKit
import WebKit

extension WebKitTab {
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
               type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    let kinds: [String]
    switch type {
    case .camera: kinds = ["camera"]
    case .microphone: kinds = ["microphone"]
    default: kinds = ["camera", "microphone"]
    }
    let originString = Origins.of(origin)
    WebKitHub.shared.permissions.request(browserId: browserId, tabId: transferKey, profile: profile, origin: originString, kinds: kinds) { [weak webView] allowed in
      if allowed, let view = webView as? WebKitWebView {
        for kind in kinds { view.captureOrigins[kind, default: []].insert(originString) }
      }
      decisionHandler(allowed ? .grant : .deny)
    }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping () -> Void) {
    guard let window, !LaunchConfig.shared.background else { return completionHandler() }
    let alert = NSAlert()
    alert.messageText = Self.sheetTitle(frame)
    alert.informativeText = message
    alert.addButton(withTitle: "OK")
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping (Bool) -> Void) {
    guard let window, !LaunchConfig.shared.background else { return completionHandler(false) }
    let alert = NSAlert()
    alert.messageText = Self.sheetTitle(frame)
    alert.informativeText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    guard let window, !LaunchConfig.shared.background else { return completionHandler(nil) }
    let alert = NSAlert()
    alert.messageText = Self.sheetTitle(frame)
    alert.informativeText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
  }

  static func sheetTitle(_ frame: WKFrameInfo) -> String {
    let host = frame.securityOrigin.host
    return host.isEmpty ? "This page says" : "\(host) says"
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping ([URL]?) -> Void) {
    guard let window else { return completionHandler(nil) }
    if LaunchConfig.shared.background {
      NSLog("[webkit] file panel (background mode, not shown)")
      return completionHandler(nil)
    }
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
  }
}

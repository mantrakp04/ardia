import ArdiaBrowser
import ExpoModulesCore
import UIKit

enum PagePayloads {
  static func error(_ code: String, _ message: String) -> Exception {
    Exception(name: code, description: message, code: code)
  }

  static func badArgs(_ message: String) -> Exception {
    error("ERR_BAD_ARGS", message)
  }

  @MainActor
  static func state(_ page: WebTab, faviconURL: String?, isDesktopSite: Bool) -> [String: Any] {
    var state: [String: Any] = [
      "title": page.title,
      "progress": page.progress,
      "isLoading": page.isLoading,
      "canGoBack": page.canGoBack,
      "canGoForward": page.canGoForward,
      "security": security(page.security),
      "pageZoom": page.pageZoom,
      "isDesktopSite": isDesktopSite,
      "scrollDirection": page.scrollDirection == .down ? "down" : "up",
      "isScrolledToTop": page.isScrolledToTop,
      "blockedRequests": page.blockedResources.count,
      "isLive": page.isLive,
      "isPrivate": page.isPrivate,
    ]
    if let url = page.url?.absoluteString, url != "about:blank" { state["url"] = url }
    if let faviconURL { state["faviconUrl"] = faviconURL }
    if let theme = ToneColor(page.themeColor) { state["themeColor"] = theme.hex }
    if let background = ToneColor(page.underPageBackgroundColor) { state["backgroundColor"] = background.hex }
    if let failure = page.failure { state["failure"] = Self.failure(failure) }
    return state
  }

  static func security(_ security: PageSecurity) -> String {
    switch security {
    case .none: "none"
    case .secure: "secure"
    case .mixed: "mixed"
    case .insecure: "insecure"
    }
  }

  static func failure(_ failure: PageLoadFailure) -> [String: Any?] {
    switch failure {
    case .crashed:
      ["kind": "crashed", "reason": nil, "title": String(localized: "This Webpage Stopped Working"), "message": String(localized: "Reload the page to try again.")]
    case .network(let title, let message):
      ["kind": "network", "reason": nil, "title": title, "message": message]
    }
  }

  static func visitKind(_ kind: PageVisitKind) -> String { kind.rawValue }

  @MainActor
  static func request(_ request: PageRequest) -> [String: Any?] {
    var payload: [String: Any?] = ["id": request.id.uuidString, "host": request.host, "title": request.title, "message": request.message]
    switch request.kind {
    case .alert(let message):
      payload["kind"] = "alert"
      payload["text"] = message
    case .confirm(let message):
      payload["kind"] = "confirm"
      payload["text"] = message
    case .prompt(let message, let defaultText):
      payload["kind"] = "prompt"
      payload["text"] = message
      payload["defaultText"] = defaultText
    case .openExternal(let url, let app):
      payload["kind"] = "openExternal"
      payload["url"] = url.absoluteString
      payload["app"] = externalApp(app)
    case .httpAuthentication(let realm, let isProxy, let failedBefore, let isSecure):
      payload["kind"] = "httpAuthentication"
      payload["realm"] = realm
      payload["isProxy"] = isProxy
      payload["failedBefore"] = failedBefore
      payload["isSecure"] = isSecure
    case .mediaCapture(let capture):
      payload["kind"] = "permission"
      payload["permission"] = switch capture {
      case .camera: "camera"
      case .microphone: "microphone"
      case .cameraAndMicrophone: "cameraAndMicrophone"
      }
    case .location:
      payload["kind"] = "permission"
      payload["permission"] = "location"
    }
    return payload
  }

  static func externalApp(_ app: ExternalApp) -> String {
    switch app {
    case .phone: "phone"
    case .mail: "email"
    case .messages: "messages"
    case .maps: "maps"
    case .appStore: "store"
    case .faceTime, .other: "other"
    }
  }

  static func answer(type: String, text: String?, user: String?, password: String?) throws -> PageRequest.Answer? {
    switch type {
    case "dismiss": return .dismissed
    case "accept": return .accepted
    case "text":
      guard let text else { throw badArgs("A text answer needs text") }
      return .text(text)
    case "credential":
      guard let user, let password else { throw badArgs("A credential answer needs user and password") }
      return .credential(user: user, password: password)
    case "files", "pickFiles":
      return nil
    default:
      throw badArgs("Unknown answer type \(type)")
    }
  }

  static func readable(_ content: ReadableContent) -> [String: Any?] {
    [
      "url": content.url,
      "title": content.title,
      "siteName": content.siteName,
      "byline": content.byline,
      "excerpt": content.excerpt,
      "leadImage": content.leadImage,
      "language": content.language,
      "paragraphs": content.paragraphs,
      "html": content.html,
      "wordCount": content.wordCount,
      "isArticle": content.isArticle,
    ]
  }

  static func download(_ progress: DownloadProgressInfo) -> [String: Any?] {
    [
      "id": progress.id.uuidString,
      "fileName": progress.fileName,
      "bytes": Double(progress.bytes),
      "total": progress.total.map(Double.init),
      "fraction": progress.fraction,
      "isQueued": progress.isQueued,
    ]
  }

  static func nightShade(_ mode: NightShadeMode) -> String { mode.rawValue }

  static func nightShadeMode(_ raw: String) throws -> NightShadeMode {
    guard let mode = NightShadeMode(rawValue: raw) else { throw badArgs("Unknown Night Shade mode \(raw)") }
    return mode
  }

  static func compact(_ fields: [String: Any?]) -> [String: Any] {
    fields.compactMapValues { $0 }
  }
}

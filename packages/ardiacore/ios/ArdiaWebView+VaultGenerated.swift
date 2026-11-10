import AppKit

extension ArdiaWebView {
  func keepGeneratedForLater(_ password: String, origin: String, replacing previous: String?) {
    VaultGenerated.installSubmitHook()
    VaultGenerated.keep(password: password, origin: origin, replacing: previous)
  }

  func stageVaultPassword(origin: String) -> [String: Any] {
    VaultPasswordDrafts.stage(page: self, origin: origin)
  }

  func fillKeptGenerated(frameId: String, origin: String, id: String, fields: [String], userChose: Bool, submit: Bool,
                         _ completion: @escaping ([String: Any]) -> Void) {
    let refuse = { (error: VaultFillError) in completion(["filled": [String](), "error": error.rawValue]) }
    guard let frameOrigin = vaultOrigin(ofFrame: frameId), frameOrigin == origin else { return refuse(.originMismatch) }
    guard VaultOriginMatch.isSecure(frameOrigin) else { return refuse(.insecure) }
    Task { @MainActor in
      guard let entry = await VaultGenerated.entry(id) else { return refuse(.notFound) }
      guard userChose || VaultOriginMatch.matches([entry.origin], origin: frameOrigin) else { return refuse(.originMismatch) }
      let wantsPassword = fields.contains("password") || fields.contains("newPassword")
      let touched = VaultOwnerCheck.takeGrant()
      if wantsPassword, !touched, !(await VaultBroker.shared.ownerAllows("fill your password")) { return refuse(.notAuthorized) }
      var values: [String: String] = [:]
      if fields.contains("username"), !entry.username.isEmpty { values["username"] = entry.username }
      if wantsPassword {
        values["password"] = entry.password
        values["newPassword"] = entry.password
      }
      guard !values.isEmpty else { return refuse(.notFound) }
      self.fillVault(frame: frameId, origin: frameOrigin, values: values, submit: submit && touched) { filled in
        if filled.contains("password") || filled.contains("newPassword") {
          VaultGenerated.installSubmitHook()
          self.keepGeneratedVaultPassword(entry.password, origin: frameOrigin)
        }
        completion(["filled": filled])
      }
    }
  }
}

@MainActor
final class VaultPasswordDraft {
  weak var page: ArdiaWebView?
  let origin: String
  let username: String
  var password: String

  init(page: ArdiaWebView, origin: String, username: String, password: String) {
    self.page = page
    self.origin = origin
    self.username = username
    self.password = password
  }
}

@MainActor
enum VaultPasswordDrafts {
  static let mostDrafts = 8
  static let longestPassword = 4096
  private static var drafts: [String: VaultPasswordDraft] = [:]
  private static var order: [String] = []

  static func stage(page: ArdiaWebView, origin: String) -> [String: Any] {
    guard let login = page.peekVaultLogin(origin: origin), let password = login["password"], !password.isEmpty else {
      return ["token": "", "length": 0]
    }
    while order.count >= mostDrafts { drop(order[0]) }
    let token = UUID().uuidString
    drafts[token] = VaultPasswordDraft(page: page, origin: origin, username: login["username"] ?? "", password: password)
    order.append(token)
    return ["token": token, "length": password.count]
  }

  static func value(_ token: String) -> String? { drafts[token]?.password }

  static func edit(_ token: String, to password: String) {
    guard let draft = drafts[token], !password.isEmpty, password.count <= longestPassword, password != draft.password else { return }
    guard let page = draft.page else { return drop(token) }
    let previous = draft.password
    draft.password = password
    page.keepVaultLogin(username: draft.username, password: password, origin: draft.origin)
    VaultGenerated.replacePassword(origin: draft.origin, from: previous, to: password)
  }

  static func drop(_ token: String) {
    drafts[token]?.password = ""
    drafts[token] = nil
    order.removeAll { $0 == token }
  }
}

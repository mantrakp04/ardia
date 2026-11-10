import AppKit

enum PageFillTarget {
  static let contextMenu = "contextMenu"
}

extension ArdiaWebView {
  func fillVaultContextField(frameId: String, origin: String, provider: String, id: String, fields: [String],
                             _ completion: @escaping ([String: Any]) -> Void) {
    guard let frameOrigin = vaultOrigin(ofFrame: frameId), frameOrigin == origin else {
      return completion(["filled": [String](), "error": VaultFillError.originMismatch.rawValue])
    }
    Task { @MainActor in
      let result = await VaultBroker.shared.fillValues(provider: provider, id: id, fields: fields, origin: frameOrigin, userChose: true,
                                                       profile: ArdiaHost.baseProfile(of: self.profile))
      switch result {
      case .failure(let error):
        completion(["filled": [String](), "error": error.rawValue])
      case .success(let fill):
        self.armVaultContextFill()
        self.fillVault(frame: frameId, origin: frameOrigin, values: fill.values, submit: false) { filled in completion(["filled": filled]) }
        self.disarmVaultContextFill()
      }
    }
  }

  func fillVaultContextGenerated(frameId: String, origin: String, style: String, maxLength: Int?, _ completion: @escaping ([String: Any]) -> Void) {
    armVaultContextFill()
    fillGeneratedPassword(frameId: frameId, origin: origin, style: style, maxLength: maxLength, completion)
    disarmVaultContextFill()
  }

  func setVaultContextMenu(frameId: String, origin: String, menu: [String: Any]) {
    applyVaultContextMenu(menu, frame: frameId, origin: origin)
  }
}

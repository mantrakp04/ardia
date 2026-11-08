import AppKit

extension ArdiaWebView: PageTab {
  private static let longestUsername = 1024

  func startPage() {}

  func closePage() { closeBrowser() }

  func downloadFavicon(_ url: String, completion: @escaping ([String: Any]?) -> Void) {
    downloadFavicon(url, name: nil, completion: completion)
  }

  func fillFromVault(frameId: String, origin: String, provider: String, id: String, fields: [String], userChose: Bool, submit: Bool,
                     _ completion: @escaping ([String: Any]) -> Void) {
    guard let frameOrigin = vaultOrigin(ofFrame: frameId), frameOrigin == origin else {
      return completion(["filled": [String](), "error": VaultFillError.originMismatch.rawValue])
    }
    Task { @MainActor in
      let result = await VaultBroker.shared.fillValues(provider: provider, id: id, fields: fields, origin: frameOrigin, userChose: userChose)
      switch result {
      case .failure(let error):
        completion(["filled": [String](), "error": error.rawValue])
      case .success(let values):
        self.fillVault(frame: frameId, origin: frameOrigin, values: values, submit: submit) { filled in completion(["filled": filled]) }
      }
    }
  }

  func fillGeneratedPassword(frameId: String, origin: String, style: String, maxLength: Int?, _ completion: @escaping ([String: Any]) -> Void) {
    guard let frameOrigin = vaultOrigin(ofFrame: frameId), frameOrigin == origin else {
      return completion(["filled": [String]()])
    }
    let password = VaultPasswordGenerator.generate(style: VaultPasswordStyle(named: style), maxLength: maxLength)
    fillVault(frame: frameId, origin: frameOrigin, values: ["newPassword": password], submit: false) { filled in
      if filled.contains("newPassword") { self.keepGeneratedVaultPassword(password, origin: frameOrigin) }
      completion(["filled": filled])
    }
  }

  func saveToVault(provider: String, origin: String, title: String?, username: String?, _ completion: @escaping ([String: Any]) -> Void) {
    guard let login = takeVaultLogin(origin: origin), let password = login["password"], !password.isEmpty else {
      return completion(["saved": false, "error": VaultFillError.notFound.rawValue])
    }
    let captured = login["username"] ?? ""
    let override = String((username ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.longestUsername))
    let chosen = override.isEmpty ? captured : override
    Task { @MainActor in
      let result = await VaultBroker.shared.save(provider: provider, origin: origin, username: chosen, password: password, title: title)
      switch result {
      case .success(let item):
        self.discardVaultCapture(origin: origin)
        completion(["saved": true, "item": item.jsonObject()])
      case .failure(let error):
        self.keepVaultLogin(username: captured, password: password, origin: origin)
        completion(["saved": false, "error": error.rawValue])
      }
    }
  }
}

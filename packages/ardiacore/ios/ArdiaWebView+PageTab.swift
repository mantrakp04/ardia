import AppKit

extension ArdiaWebView: PageTab {
  func startPage() {}

  func closePage() { closeBrowser() }

  func downloadFavicon(_ url: String, completion: @escaping ([String: Any]?) -> Void) {
    downloadFavicon(url, name: nil, completion: completion)
  }

  func fillFromVault(frameId: String, origin: String, provider: String, id: String, fields: [String], userChose: Bool,
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
        self.fillVault(frame: frameId, origin: frameOrigin, values: values) { filled in completion(["filled": filled]) }
      }
    }
  }

  func fillGeneratedPassword(frameId: String, origin: String, _ completion: @escaping ([String: Any]) -> Void) {
    guard let frameOrigin = vaultOrigin(ofFrame: frameId), frameOrigin == origin else {
      return completion(["filled": [String]()])
    }
    let password = VaultPasswordGenerator.generate()
    fillVault(frame: frameId, origin: frameOrigin, values: ["newPassword": password]) { filled in
      if filled.contains("newPassword") { self.keepVaultLogin(username: "", password: password, origin: frameOrigin) }
      completion(["filled": filled])
    }
  }

  func saveToVault(provider: String, origin: String, title: String?, _ completion: @escaping ([String: Any]) -> Void) {
    guard let login = takeVaultLogin(origin: origin), let password = login["password"], !password.isEmpty else {
      return completion(["saved": false, "error": VaultFillError.notFound.rawValue])
    }
    let username = login["username"] ?? ""
    Task { @MainActor in
      let result = await VaultBroker.shared.save(provider: provider, origin: origin, username: username, password: password, title: title)
      switch result {
      case .success(let item):
        completion(["saved": true, "item": item.jsonObject()])
      case .failure(let error):
        self.keepVaultLogin(username: username, password: password, origin: origin)
        completion(["saved": false, "error": error.rawValue])
      }
    }
  }
}

struct VaultSignInResult: Codable, Equatable, Sendable {
  var ok: Bool
  var state: VaultProviderState
  var needs: VaultSignInNeed? = nil
  var methods: [VaultMethod]? = nil
  var error: String? = nil
  var approvalURL: String? = nil

  func jsonObject() -> [String: Any] { VaultJSON.object(self) }
}

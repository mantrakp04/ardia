struct VaultProviderState: Codable, Equatable, Sendable {
  var id: String
  var name: String
  var state: VaultState
  var account: String? = nil
  var server: String? = nil
  var cliPath: String? = nil
  var cliVersion: String? = nil
  var message: String? = nil
  var capabilities: VaultCapabilities
  var install: VaultInstall
  var setup: VaultSetup? = nil
  var touchUnlock = false

  func jsonObject() -> [String: Any] { VaultJSON.object(self) }
}

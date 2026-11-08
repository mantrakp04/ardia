struct VaultSetup: Codable, Equatable, Sendable {
  var kind: VaultSetupKind
  var appURL: String? = nil
}

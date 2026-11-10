struct VaultCapabilities: Codable, Equatable, Sendable {
  var totp: Bool
  var save: Bool
  var selfHosted: Bool
  var masterPassword: Bool
  var touchID: Bool
  var addTotp: Bool = false
}

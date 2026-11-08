enum VaultRegistry {
  static let providers: [any VaultProvider] = [OnePasswordVault(), BitwardenVault(), ProtonPassVault()]

  static func provider(_ id: String) -> (any VaultProvider)? { providers.first { $0.id == id } }
}

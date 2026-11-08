enum VaultSignInNeed: String, Codable, Sendable {
  case code
  case password
  case email
  case approval
}

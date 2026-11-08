enum VaultState: String, Codable, Sendable {
  case notInstalled
  case signedOut
  case locked
  case unlocked
  case unavailable
}

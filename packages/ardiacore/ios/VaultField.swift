enum VaultField: String, Sendable {
  case username
  case password
  case totp
}

enum VaultCopyField: String, Sendable {
  case username
  case password

  var field: VaultField {
    switch self {
    case .username: return .username
    case .password: return .password
    }
  }
}

enum VaultError: Error, Equatable, Sendable {
  case locked
  case signedOut
  case notFound
  case unsupported
  case failed(String)
}

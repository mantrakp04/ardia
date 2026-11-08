enum VaultFillError: String, Error, Sendable {
  case locked
  case originMismatch
  case insecure
  case notFound
  case failed
  case notAuthorized
}

struct VaultItem: Codable, Equatable, Sendable {
  var provider: String
  var id: String
  var title: String
  var username: String
  var urls: [String]
  var hasTotp: Bool? = nil
  var vault: String? = nil
  var favorite: Bool? = nil
  var updatedAt: Double? = nil
  var totpPeriod: Int? = nil

  enum CodingKeys: String, CodingKey {
    case provider, id, title, username, urls, hasTotp, vault, favorite, updatedAt
  }

  func jsonObject() -> [String: Any] { VaultJSON.object(self) }
}

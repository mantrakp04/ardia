import Foundation

struct VaultSignInFields: Sendable {
  var email: String? = nil
  var password: String? = nil
  var code: String? = nil
  var method: String? = nil
  var server: String? = nil
  var clientId: String? = nil
  var clientSecret: String? = nil
  var account: String? = nil
}

extension VaultSignInFields {
  init(json: String) {
    self.init()
    guard let object = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else { return }
    email = Self.trimmed(object["email"])
    password = Self.exact(object["password"])
    code = Self.trimmed(object["code"])?.replacingOccurrences(of: " ", with: "")
    method = Self.trimmed(object["method"])
    server = Self.trimmed(object["server"])
    clientId = Self.trimmed(object["clientId"])
    clientSecret = Self.trimmed(object["clientSecret"])
    account = Self.trimmed(object["account"])
  }

  private static func exact(_ value: Any?) -> String? {
    if let text = value as? String { return text.isEmpty ? nil : text }
    if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { return number.stringValue }
    return nil
  }

  private static func trimmed(_ value: Any?) -> String? {
    guard let text = exact(value)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
    return text
  }
}

import CryptoKit
import Foundation

struct VaultTotpSecret: Equatable, Sendable {
  enum Algorithm: String, Sendable {
    case sha1, sha256, sha512
  }

  let key: Data
  let digits: Int
  let period: Int
  let algorithm: Algorithm

  init(key: Data, digits: Int = 6, period: Int = VaultTotp.defaultPeriod, algorithm: Algorithm = .sha1) {
    self.key = key
    self.digits = digits
    self.period = period
    self.algorithm = algorithm
  }

  init?(_ text: String) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 2048 else { return nil }
    if trimmed.lowercased().hasPrefix("otpauth://") {
      guard let components = URLComponents(string: trimmed), components.host?.lowercased() == "totp" else { return nil }
      var query: [String: String] = [:]
      for item in components.queryItems ?? [] { query[item.name.lowercased()] = item.value }
      guard let secret = query["secret"], let key = Self.base32(secret) else { return nil }
      let digits = query["digits"].flatMap { Int($0) } ?? 6
      let period = query["period"].flatMap { Int($0) } ?? VaultTotp.defaultPeriod
      guard (6...8).contains(digits), (1...300).contains(period) else { return nil }
      let algorithm: Algorithm
      switch query["algorithm"]?.lowercased() ?? "sha1" {
      case "sha1": algorithm = .sha1
      case "sha256": algorithm = .sha256
      case "sha512": algorithm = .sha512
      default: return nil
      }
      self.init(key: key, digits: digits, period: period, algorithm: algorithm)
      return
    }
    guard !trimmed.contains("://"), let key = Self.base32(trimmed) else { return nil }
    self.init(key: key)
  }

  func code(at date: Date = Date()) -> String {
    let counter = UInt64(max(0, floor(date.timeIntervalSince1970 / Double(period))))
    let message = withUnsafeBytes(of: counter.bigEndian) { Data($0) }
    let symmetric = SymmetricKey(data: key)
    let mac: Data
    switch algorithm {
    case .sha1: mac = Data(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: symmetric))
    case .sha256: mac = Data(HMAC<SHA256>.authenticationCode(for: message, using: symmetric))
    case .sha512: mac = Data(HMAC<SHA512>.authenticationCode(for: message, using: symmetric))
    }
    let bytes = [UInt8](mac)
    let offset = Int(bytes[bytes.count - 1] & 0x0f)
    let binary = (UInt32(bytes[offset] & 0x7f) << 24) | (UInt32(bytes[offset + 1]) << 16) | (UInt32(bytes[offset + 2]) << 8)
      | UInt32(bytes[offset + 3])
    var modulus: UInt32 = 1
    for _ in 0..<digits { modulus *= 10 }
    let value = String(binary % modulus)
    return String(repeating: "0", count: max(0, digits - value.count)) + value
  }

  func totp(at date: Date = Date()) -> VaultTotp? { VaultTotp.make(code: code(at: date), period: period, now: date) }

  private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

  static func base32(_ text: String) -> Data? {
    let cleaned = text.uppercased().filter { !$0.isWhitespace && $0 != "-" && $0 != "=" }
    guard !cleaned.isEmpty else { return nil }
    var buffer: UInt32 = 0
    var bits = 0
    var bytes: [UInt8] = []
    for character in cleaned {
      guard let index = alphabet.firstIndex(of: character) else { return nil }
      buffer = (buffer << 5) | UInt32(index)
      bits += 5
      if bits >= 8 {
        bits -= 8
        bytes.append(UInt8((buffer >> UInt32(bits)) & 0xff))
      }
    }
    return bytes.isEmpty ? nil : Data(bytes)
  }
}

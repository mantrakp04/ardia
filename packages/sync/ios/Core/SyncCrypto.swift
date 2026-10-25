import CryptoKit
import Foundation

public struct SyncKeys {
  static let magic = Data(LegacyName.syncMagic.utf8)
  static let salt = Data(LegacyName.syncSalt.utf8)
  static let padding = 1024

  let fileKey: SymmetricKey
  let nameKey: SymmetricKey

  public enum Failure: Error, Equatable {
    case format
    case authentication
  }

  public init(entropy: Data) {
    let ikm = SymmetricKey(data: entropy)
    fileKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: Self.salt, info: Data("file-key".utf8), outputByteCount: 32)
    nameKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: Self.salt, info: Data("name-key".utf8), outputByteCount: 32)
  }

  public var chainTag: String { tag("chain") }

  public func scopeTag(_ scope: String) -> String { tag("scope/" + scope) }

  func tag(_ label: String) -> String {
    Base32.encode(Data(HMAC<SHA256>.authenticationCode(for: Data(label.utf8), using: nameKey)).prefix(16))
  }

  static func associatedData(chain: String, scope: String, file: String) -> Data {
    magic + Data("\(chain)/\(scope)/\(file)".utf8)
  }

  public func seal(_ payload: Data, scopeTag: String, fileId: String) throws -> Data {
    var plain = withUnsafeBytes(of: UInt32(payload.count).bigEndian) { Data($0) } + payload
    plain.append(Data(count: (Self.padding - plain.count % Self.padding) % Self.padding))
    let box = try AES.GCM.seal(plain, using: fileKey, authenticating: Self.associatedData(chain: chainTag, scope: scopeTag, file: fileId))
    return Self.magic + box.nonce + box.ciphertext + box.tag
  }

  public func open(_ file: Data, scopeTag: String, fileId: String) throws -> Data {
    let file = Data(file)
    guard file.count >= Self.magic.count + 12 + 16 + 4, file.prefix(Self.magic.count) == Self.magic else { throw Failure.format }
    let body = file.dropFirst(Self.magic.count)
    let plain: Data
    do {
      let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: body.prefix(12)), ciphertext: body.dropFirst(12).dropLast(16), tag: body.suffix(16))
      plain = try AES.GCM.open(box, using: fileKey, authenticating: Self.associatedData(chain: chainTag, scope: scopeTag, file: fileId))
    } catch {
      throw Failure.authentication
    }
    let length = plain.prefix(4).reduce(0) { $0 << 8 | Int($1) }
    guard length <= plain.count - 4 else { throw Failure.format }
    return Data(plain.dropFirst(4).prefix(length))
  }

  public static func newFileId() -> String {
    Base32.encode(RecoveryPhrase.generateEntropy().prefix(16))
  }
}

public struct SyncPasswords {
  static let associatedData = Data("ardia-sync/password".utf8)
  static let rewrittenFields: Set<String> = ["p", "d", "s"]

  let digestKey: SymmetricKey
  let secretKey: SymmetricKey

  public enum Failure: Error, Equatable {
    case unreadableSecret
    case malformed
  }

  public init(entropy: Data) {
    let ikm = SymmetricKey(data: entropy)
    digestKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: SyncKeys.salt, info: Data("password-digest".utf8), outputByteCount: 32)
    secretKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: SyncKeys.salt, info: Data("password-secret".utf8), outputByteCount: 32)
  }

  public func digest(_ password: String) -> String {
    Data(HMAC<SHA256>.authenticationCode(for: Data(password.utf8), using: digestKey)).prefix(16).base64EncodedString()
  }

  public func seal(_ password: String) throws -> String {
    guard let combined = try AES.GCM.seal(Data(password.utf8), using: secretKey, authenticating: Self.associatedData).combined else {
      throw Failure.unreadableSecret
    }
    return combined.base64EncodedString()
  }

  public func open(_ secret: String) -> String? {
    guard let data = Data(base64Encoded: secret), let box = try? AES.GCM.SealedBox(combined: data),
          let plain = try? AES.GCM.open(box, using: secretKey, authenticating: Self.associatedData) else { return nil }
    return String(data: plain, encoding: .utf8)
  }

  public func toWire(_ payload: String) throws -> String {
    try rewrite(payload) { fields in
      guard let secret = fields["s"] else { return nil }
      guard let password = open(secret) else { throw Failure.unreadableSecret }
      return [("p", password)]
    }
  }

  public func fromWire(_ payload: String) throws -> String {
    try rewrite(payload) { fields in
      guard let password = fields["p"] else { return nil }
      return [("d", digest(password)), ("s", try seal(password))]
    }
  }

  func rewrite(_ payload: String, _ replacement: ([String: String]) throws -> [(String, String)]?) throws -> String {
    guard payload.contains("\"pw:") else { return payload }
    let bytes = Array(payload.utf8)
    var scan = PasswordScan(bytes)
    try scan.document()
    var out: [UInt8] = []
    var copied = 0
    for value in scan.found.sorted(by: { $0.range.lowerBound < $1.range.lowerBound }) where value.range.lowerBound >= copied {
      var fields: [String: String] = [:]
      for member in value.members where member.isString && Self.rewrittenFields.contains(member.key) {
        fields[member.key] = try JSONText.unquote(bytes[(member.value.lowerBound + 1)..<(member.value.upperBound - 1)], strict: true)
      }
      guard let added = try replacement(fields) else { continue }
      let kept = value.members.filter { !Self.rewrittenFields.contains($0.key) }.map { Array(bytes[$0.range]) }
      let fresh = added.map { Array((JSONText.quote($0.0) + ":" + JSONText.quote($0.1)).utf8) }
      out += bytes[copied..<value.range.lowerBound]
      out.append(UInt8(ascii: "{"))
      out += (kept + fresh).joined(separator: [UInt8(ascii: ",")])
      out.append(UInt8(ascii: "}"))
      copied = value.range.upperBound
    }
    if copied == 0 { return payload }
    out += bytes[copied...]
    return String(decoding: out, as: UTF8.self)
  }
}

struct PasswordScan {
  struct Member {
    let key: String
    let range: Range<Int>
    let value: Range<Int>
    let isString: Bool
  }

  struct Found {
    let range: Range<Int>
    let members: [Member]
  }

  let bytes: [UInt8]
  var at = 0
  var found: [Found] = []

  init(_ bytes: [UInt8]) {
    self.bytes = bytes
  }

  mutating func document() throws {
    _ = try value(record: false, keep: false)
    space()
    guard at == bytes.count else { throw SyncPasswords.Failure.malformed }
  }

  private var next: UInt8? { at < bytes.count ? bytes[at] : nil }

  private static func isSpace(_ byte: UInt8) -> Bool { byte == 0x20 || byte == 0x0A || byte == 0x0D || byte == 0x09 }

  private mutating func space() {
    while let byte = next, Self.isSpace(byte) { at += 1 }
  }

  private mutating func value(record: Bool, keep: Bool) throws -> [Member]? {
    space()
    switch next {
    case UInt8(ascii: "{"): return try object(record: record, keep: keep)
    case UInt8(ascii: "["): try array()
    case UInt8(ascii: "\""): try skipString()
    case .some: try scalar()
    case nil: throw SyncPasswords.Failure.malformed
    }
    return nil
  }

  private mutating func object(record: Bool, keep: Bool) throws -> [Member]? {
    at += 1
    var members: [Member] = []
    var op: String?
    var inner: Found?
    space()
    if next == UInt8(ascii: "}") {
      at += 1
      return keep ? [] : nil
    }
    while true {
      space()
      let start = at
      let key = try string()
      space()
      guard next == UInt8(ascii: ":") else { throw SyncPasswords.Failure.malformed }
      at += 1
      space()
      let valueStart = at
      let isString = next == UInt8(ascii: "\"")
      if key == "k", isString {
        op = try string()
      } else if let children = try value(record: key.hasPrefix("pw:"), keep: key == "v"), key == "v" {
        inner = Found(range: valueStart..<at, members: children)
      }
      if keep { members.append(Member(key: key, range: start..<at, value: valueStart..<at, isString: isString)) }
      space()
      guard let byte = next else { throw SyncPasswords.Failure.malformed }
      at += 1
      if byte == UInt8(ascii: "}") { break }
      guard byte == UInt8(ascii: ",") else { throw SyncPasswords.Failure.malformed }
    }
    if let inner, record || op?.hasPrefix("pw:") == true { found.append(inner) }
    return keep ? members : nil
  }

  private mutating func array() throws {
    at += 1
    space()
    if next == UInt8(ascii: "]") {
      at += 1
      return
    }
    while true {
      _ = try value(record: false, keep: false)
      space()
      guard let byte = next else { throw SyncPasswords.Failure.malformed }
      at += 1
      if byte == UInt8(ascii: "]") { return }
      guard byte == UInt8(ascii: ",") else { throw SyncPasswords.Failure.malformed }
    }
  }

  private mutating func skipString() throws {
    at += 1
    while let byte = next {
      at += byte == UInt8(ascii: "\\") ? 2 : 1
      if byte == UInt8(ascii: "\"") { return }
    }
    throw SyncPasswords.Failure.malformed
  }

  private mutating func string() throws -> String {
    guard next == UInt8(ascii: "\"") else { throw SyncPasswords.Failure.malformed }
    let start = at + 1
    try skipString()
    return try JSONText.unquote(bytes[start..<(at - 1)])
  }

  private mutating func scalar() throws {
    let start = at
    while let byte = next, !Self.isSpace(byte), byte != UInt8(ascii: ","), byte != UInt8(ascii: "}"), byte != UInt8(ascii: "]") { at += 1 }
    guard at > start else { throw SyncPasswords.Failure.malformed }
  }
}

enum JSONText {
  static func quote(_ text: String) -> String {
    var out = "\""
    for scalar in text.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case _ where scalar.value < 0x20: out += String(format: "\\u%04x", scalar.value)
      default: out.unicodeScalars.append(scalar)
      }
    }
    return out + "\""
  }

  static func unquote(_ raw: ArraySlice<UInt8>, strict: Bool = false) throws -> String {
    guard raw.contains(UInt8(ascii: "\\")) else { return String(decoding: raw, as: UTF8.self) }
    var out: [UInt8] = []
    var units: [UInt16] = []
    func flushUnits() throws {
      guard !units.isEmpty else { return }
      var decoded = String.UnicodeScalarView()
      var codec = UTF16()
      var iterator = units.makeIterator()
      decoding: while true {
        switch codec.decode(&iterator) {
        case .scalarValue(let scalar): decoded.append(scalar)
        case .emptyInput: break decoding
        case .error:
          if strict { throw SyncPasswords.Failure.malformed }
          decoded.append("\u{FFFD}")
        }
      }
      out += Array(String(decoded).utf8)
      units.removeAll()
    }
    var index = raw.startIndex
    while index < raw.endIndex {
      let byte = raw[index]
      guard byte == UInt8(ascii: "\\") else {
        try flushUnits()
        out.append(byte)
        index += 1
        continue
      }
      guard index + 1 < raw.endIndex else { throw SyncPasswords.Failure.malformed }
      let escape = raw[index + 1]
      if escape == UInt8(ascii: "u") {
        guard index + 6 <= raw.endIndex, let unit = UInt16(String(decoding: raw[(index + 2)..<(index + 6)], as: UTF8.self), radix: 16) else {
          throw SyncPasswords.Failure.malformed
        }
        units.append(unit)
        index += 6
        continue
      }
      try flushUnits()
      switch escape {
      case UInt8(ascii: "\""), UInt8(ascii: "\\"), UInt8(ascii: "/"): out.append(escape)
      case UInt8(ascii: "b"): out.append(0x08)
      case UInt8(ascii: "f"): out.append(0x0C)
      case UInt8(ascii: "n"): out.append(0x0A)
      case UInt8(ascii: "r"): out.append(0x0D)
      case UInt8(ascii: "t"): out.append(0x09)
      default: throw SyncPasswords.Failure.malformed
      }
      index += 2
    }
    try flushUnits()
    return String(decoding: out, as: UTF8.self)
  }
}

enum Base32 {
  static let alphabet = Array("abcdefghijklmnopqrstuvwxyz234567")

  static func encode(_ data: Data) -> String {
    var out = ""
    var buffer = 0, bits = 0
    for byte in data {
      buffer = buffer << 8 | Int(byte)
      bits += 8
      while bits >= 5 {
        out.append(alphabet[(buffer >> (bits - 5)) & 31])
        bits -= 5
      }
      buffer &= (1 << bits) - 1
    }
    if bits > 0 { out.append(alphabet[(buffer << (5 - bits)) & 31]) }
    return out
  }

  static func isTag(_ name: String) -> Bool {
    name.count == 26 && name.allSatisfy { alphabet.contains($0) }
  }
}

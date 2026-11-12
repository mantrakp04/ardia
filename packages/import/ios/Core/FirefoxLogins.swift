import CommonCrypto
import CryptoKit
import Foundation

public enum FirefoxLogins {
  static let oidPBES2 = "1.2.840.113549.1.5.13"
  static let oidPBKDF2 = "1.2.840.113549.1.5.12"
  static let oidSHA1And3DES = "1.2.840.113549.1.12.5.1.3"
  static let oidAES256CBC = "2.16.840.1.101.3.4.1.42"
  static let oid3DESCBC = "1.2.840.113549.3.7"
  static let ckaId = Data([0xF8] + [UInt8](repeating: 0, count: 14) + [0x01])
  static let loginsDatabaseKeyLabel = Data("as-logins-key".utf8)

  public static func masterKey(key4: URL, primaryPassword: String = "", label: Data? = nil) throws -> Data {
    let db = try SQLiteSnapshot(copying: key4)
    guard db.tableExists("metaData"), db.tableExists("nssPrivate") else {
      throw ImportError.unsupported("key4.db has an unexpected layout")
    }
    var globalSalt: Data?
    var check: Data?
    try db.query("SELECT item1, item2 FROM metaData WHERE id = 'password'") { row in
      globalSalt = row.blob(0)
      check = row.blob(1)
      return false
    }
    guard let globalSalt, let check else { throw ImportError.unreadable("key4.db has no password entry") }
    let password = Data(primaryPassword.utf8)
    guard let clear = try? decryptPBE(DER.parse(check), globalSalt: globalSalt, password: password),
          clear.starts(with: Data("password-check".utf8)) else {
      throw ImportError.locked("Wrong Firefox primary password")
    }
    var encryptedKey: Data?
    try db.query("SELECT a11, a102, a3 FROM nssPrivate") { row in
      guard let a11 = row.blob(0) else { return true }
      if let label {
        if row.blob(2) == label { encryptedKey = a11 }
        return encryptedKey == nil
      }
      if row.blob(2) == loginsDatabaseKeyLabel { return true }
      if encryptedKey == nil || row.blob(1) == ckaId { encryptedKey = a11 }
      return row.blob(1) != ckaId
    }
    guard let encryptedKey else {
      if label != nil { throw ImportError.notFound("key4.db has no key for logins.db") }
      throw ImportError.unreadable("key4.db holds no login key")
    }
    let key = try decryptPBE(DER.parse(encryptedKey), globalSalt: globalSalt, password: password)
    guard key.count >= (label == nil ? 24 : 32) else { throw ImportError.unreadable("key4.db login key is malformed") }
    return key
  }

  public static func logins(profile: URL, primaryPassword: String = "", cancellation: Cancellation = .init()) throws -> [Credential] {
    let fm = FileManager.default
    let json = profile.appendingPathComponent("logins.json")
    let database = profile.appendingPathComponent("logins.db")
    let key4 = profile.appendingPathComponent("key4.db")
    let hasJSON = fm.fileExists(atPath: json.path)
    let hasDatabase = fm.fileExists(atPath: database.path)
    guard hasJSON || hasDatabase else { throw ImportError.notFound("No saved logins in this profile") }
    guard fm.fileExists(atPath: key4.path) else { throw ImportError.unsupported("This profile has no key4.db") }
    var stored: StoredLogins?
    var databaseFailure: Error?
    if hasDatabase {
      do {
        let key = try masterKey(key4: key4, primaryPassword: primaryPassword, label: loginsDatabaseKeyLabel)
        stored = try logins(database: database, key: key, cancellation: cancellation)
      } catch ImportError.locked(let message) {
        throw ImportError.locked(message)
      } catch ImportError.cancelled {
        throw ImportError.cancelled
      } catch {
        databaseFailure = error
      }
    }
    guard hasJSON else {
      if let stored { return stored.credentials }
      throw databaseFailure ?? ImportError.notFound("No saved logins in this profile")
    }
    guard let stored else {
      let key = try masterKey(key4: key4, primaryPassword: primaryPassword)
      return try logins(json: Data(contentsOf: json), key: key, cancellation: cancellation)
    }
    do {
      let key = try masterKey(key4: key4, primaryPassword: primaryPassword)
      let known = Set(stored.credentials.map(identity))
      let extra = try entries(json: Data(contentsOf: json), key: key, cancellation: cancellation).filter { entry in
        !(entry.guid.map(stored.guids.contains) ?? false) && !known.contains(identity(entry.credential))
      }
      return stored.credentials + extra.map(\.credential)
    } catch ImportError.cancelled {
      throw ImportError.cancelled
    } catch {
      return stored.credentials
    }
  }

  static func identity(_ c: Credential) -> [String] { [c.realm ?? "", c.url, c.username] }

  public struct StoredLogins {
    public var credentials: [Credential]
    public var guids: Set<String>
  }

  public static func logins(database: URL, key: Data, cancellation: Cancellation = .init()) throws -> StoredLogins {
    let db = try SQLiteSnapshot(copying: database)
    guard db.tableExists("loginsL") else { throw ImportError.unreadable("logins.db has no logins") }
    var guids = Set<String>()
    for table in ["loginsL", "loginsM"] where db.tableExists(table) {
      try db.query("SELECT guid FROM \(table)") { row in
        if let guid = row.text(0) { guids.insert(guid) }
        return true
      }
    }
    let columns = "origin, httpRealm, formActionOrigin, timesUsed, timeCreated, timeLastUsed, secFields"
    let mirror = db.tableExists("loginsM")
      ? " UNION ALL SELECT \(columns) FROM loginsM WHERE is_overridden = 0 AND guid NOT IN (SELECT guid FROM loginsL)"
      : ""
    var out: [Credential] = []
    var seen = 0
    try db.query("SELECT \(columns) FROM loginsL WHERE is_deleted = 0\(mirror)") { row in
      seen += 1
      if seen % 64 == 0 { try cancellation.check() }
      guard let origin = row.text(0), !origin.hasPrefix("chrome://"),
            let fields = row.text(6).flatMap({ decryptJWE($0, key: key) }),
            let secure = try? JSONSerialization.jsonObject(with: fields) as? [String: Any],
            let password = secure["p"] as? String, !password.isEmpty else { return true }
      out.append(Credential(
        url: row.text(2).flatMap { $0.isEmpty ? nil : $0 } ?? origin,
        username: secure["u"] as? String ?? "",
        password: password,
        realm: row.text(1) ?? origin,
        created: row.isNull(4) ? nil : Double(row.int(4)),
        lastUsed: row.isNull(5) ? nil : Double(row.int(5)),
        timesUsed: Int(row.int(3))
      ))
      return true
    }
    return StoredLogins(credentials: out, guids: guids)
  }

  static func decryptJWE(_ compact: String, key: Data) -> Data? {
    let parts = compact.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 5, parts[1].isEmpty, let header = base64URL(parts[0]),
          let protected = try? JSONSerialization.jsonObject(with: header) as? [String: Any],
          protected["alg"] as? String == "dir", protected["enc"] as? String == "A256GCM",
          let iv = base64URL(parts[2]), let cipher = base64URL(parts[3]), let tag = base64URL(parts[4]),
          let nonce = try? CryptoKit.AES.GCM.Nonce(data: iv),
          let box = try? CryptoKit.AES.GCM.SealedBox(nonce: nonce, ciphertext: cipher, tag: tag) else { return nil }
    return try? CryptoKit.AES.GCM.open(box, using: SymmetricKey(data: key.prefix(32)), authenticating: Data(parts[0].utf8))
  }

  static func base64URL(_ text: String) -> Data? {
    var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    s += String(repeating: "=", count: (4 - s.count % 4) % 4)
    return Data(base64Encoded: s)
  }

  public static func logins(json: Data, key: Data, cancellation: Cancellation = .init()) throws -> [Credential] {
    try entries(json: json, key: key, cancellation: cancellation).map(\.credential)
  }

  static func entries(json: Data, key: Data, cancellation: Cancellation = .init()) throws -> [(guid: String?, credential: Credential)] {
    guard let top = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
          let rows = top["logins"] as? [[String: Any]] else {
      throw ImportError.unreadable("logins.json is malformed")
    }
    var out: [(guid: String?, credential: Credential)] = []
    for row in rows {
      try cancellation.check()
      guard let host = row["hostname"] as? String, !host.hasPrefix("chrome://"),
            let user = (row["encryptedUsername"] as? String).flatMap({ decryptField($0, key: key) }),
            let pass = (row["encryptedPassword"] as? String).flatMap({ decryptField($0, key: key) }),
            !pass.isEmpty else { continue }
      out.append((row["guid"] as? String, Credential(
        url: (row["formSubmitURL"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? host,
        username: user,
        password: pass,
        realm: (row["httpRealm"] as? String) ?? host,
        created: (row["timeCreated"] as? NSNumber)?.doubleValue,
        lastUsed: (row["timeLastUsed"] as? NSNumber)?.doubleValue,
        timesUsed: row["timesUsed"] as? Int
      )))
    }
    return out
  }

  static func decryptField(_ base64: String, key: Data) -> String? {
    guard let raw = Data(base64Encoded: base64), let der = try? DER.parse(raw),
          der.children.count >= 3, der.children[1].children.count >= 2,
          let oid = der.children[1].children[0].oid else { return nil }
    let iv = der.children[1].children[1].content
    let cipher = der.children[2].content
    let plain: Data?
    switch oid {
    case oid3DESCBC:
      plain = AES.cbc(.decrypt, cipher, key: key.prefix(24), iv: iv, algorithm: CCAlgorithm(kCCAlgorithm3DES), blockSize: kCCBlockSize3DES)
    case oidAES256CBC:
      plain = AES.cbc(.decrypt, cipher, key: key.prefix(32), iv: iv)
    default:
      plain = nil
    }
    return plain.flatMap { String(data: $0, encoding: .utf8) }
  }

  static func decryptPBE(_ node: DER.Node, globalSalt: Data, password: Data) throws -> Data {
    guard node.children.count >= 2, node.children[0].children.count >= 2, let algo = node.children[0].children[0].oid else {
      throw ImportError.unreadable("Unexpected PBE structure")
    }
    let params = node.children[0].children[1]
    let cipher = node.children[1].content
    switch algo {
    case oidPBES2:
      guard params.children.count >= 2,
            params.children[0].children.count >= 2, params.children[0].children[0].oid == oidPBKDF2,
            params.children[0].children[1].children.count >= 3,
            params.children[1].children.count >= 2 else { throw ImportError.unreadable("Unexpected PBES2 parameters") }
      let kdf = params.children[0].children[1]
      let salt = kdf.children[0].content
      let iterations = kdf.children[1].integer
      let keyLength = kdf.children[2].integer
      let ivTail = params.children[1].children[1].content
      guard iterations > 0, keyLength == 32 else { throw ImportError.unsupported("Unsupported PBES2 key size") }
      let k = Data(Insecure.SHA1.hash(data: globalSalt + password))
      let key = pbkdf2SHA256(password: k, salt: salt, rounds: iterations, length: keyLength)
      let iv = Data([0x04, 0x0E]) + ivTail
      guard let clear = AES.cbc(.decrypt, cipher, key: key, iv: iv, padding: false) else { throw ImportError.locked("PBES2 decryption failed") }
      return AES.unpadLeniently(clear, blockSize: kCCBlockSizeAES128)
    case oidSHA1And3DES:
      guard let salt = params.children.first?.content else { throw ImportError.unreadable("Unexpected 3DES PBE parameters") }
      let (key, iv) = legacy3DESKey(globalSalt: globalSalt, password: password, entrySalt: salt)
      guard let clear = AES.cbc(.decrypt, cipher, key: key, iv: iv, algorithm: CCAlgorithm(kCCAlgorithm3DES),
                                blockSize: kCCBlockSize3DES, padding: false) else {
        throw ImportError.locked("3DES PBE decryption failed")
      }
      return AES.unpadLeniently(clear, blockSize: kCCBlockSize3DES)
    default:
      throw ImportError.unsupported("Unsupported PBE algorithm \(algo)")
    }
  }

  static func legacy3DESKey(globalSalt: Data, password: Data, entrySalt: Data) -> (key: Data, iv: Data) {
    let hp = Data(Insecure.SHA1.hash(data: globalSalt + password))
    let pes = entrySalt + Data(count: max(0, 20 - entrySalt.count))
    let chp = Data(Insecure.SHA1.hash(data: hp + entrySalt))
    let mac = { (message: Data) in Data(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: SymmetricKey(data: chp))) }
    let k1 = mac(pes + entrySalt)
    let tk = mac(pes)
    let k2 = mac(tk + entrySalt)
    let k = k1 + k2
    return (k.prefix(24), k.suffix(8))
  }

  static func pbkdf2SHA256(password: Data, salt: Data, rounds: Int, length: Int) -> Data {
    var out = Data(count: length)
    _ = out.withUnsafeMutableBytes { o in
      password.withUnsafeBytes { p in
        salt.withUnsafeBytes { s in
          CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), p.bindMemory(to: Int8.self).baseAddress, p.count,
                               s.bindMemory(to: UInt8.self).baseAddress, s.count,
                               CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(rounds),
                               o.bindMemory(to: UInt8.self).baseAddress, length)
        }
      }
    }
    return out
  }
}

enum DER {
  struct Node {
    var tag: UInt8
    var content: Data
    var children: [Node]

    var oid: String? {
      guard tag == 0x06, let first = content.first else { return nil }
      var parts = [Int(first) / 40, Int(first) % 40]
      var value = 0
      for byte in content.dropFirst() {
        value = value << 7 | Int(byte & 0x7F)
        if byte & 0x80 == 0 {
          parts.append(value)
          value = 0
        }
      }
      return parts.map(String.init).joined(separator: ".")
    }

    var integer: Int { content.reduce(0) { $0 << 8 | Int($1) } }
  }

  static func parse(_ data: Data) throws -> Node {
    var i = data.startIndex
    let node = try read(data, &i, depth: 0)
    return node
  }

  private static func read(_ data: Data, _ i: inout Int, depth: Int) throws -> Node {
    guard depth < 16, i + 2 <= data.endIndex else { throw ImportError.unreadable("Truncated DER") }
    let tag = data[i]
    var length = Int(data[i + 1])
    i += 2
    if length & 0x80 != 0 {
      let n = length & 0x7F
      guard n > 0, n <= 4, i + n <= data.endIndex else { throw ImportError.unreadable("Bad DER length") }
      length = data[i..<i + n].reduce(0) { $0 << 8 | Int($1) }
      i += n
    }
    guard length >= 0, i + length <= data.endIndex else { throw ImportError.unreadable("Truncated DER") }
    let content = data.subdata(in: i..<i + length)
    var children: [Node] = []
    if tag & 0x20 != 0 {
      var j = content.startIndex
      while j < content.endIndex { children.append(try read(content, &j, depth: depth + 1)) }
    }
    i += length
    return Node(tag: tag, content: content, children: children)
  }
}

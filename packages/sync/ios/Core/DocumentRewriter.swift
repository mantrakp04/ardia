import Foundation

struct DocumentRewriter {
  let oldData: String
  let newData: String
  var aliases: [String] = []

  func string(_ s: String) -> String {
    let lower = s.lowercased()
    for prefix in ["", "view-source:"] {
      for (old, new) in Renamed.urls where lower.hasPrefix(prefix + old) {
        let rest = s.dropFirst(prefix.count + old.count)
        if !old.hasSuffix("://"), let next = rest.first, !"/?#".contains(next) { continue }
        return String(s.prefix(prefix.count)) + new + rest
      }
    }
    for old in [oldData] + aliases where s == old || s.hasPrefix(old + "/") { return newData + s.dropFirst(old.count) }
    return s
  }

  func value(_ value: Any) -> Any {
    switch value {
    case let s as String:
      return string(s)
    case let list as [Any]:
      return list.map(self.value)
    case let object as [String: Any]:
      var out: [String: Any] = [:]
      for (key, v) in object {
        let newKey = Renamed.jsonKeys[key] ?? string(key)
        if newKey != key, object[newKey] != nil { continue }
        out[newKey] = self.value(v)
      }
      return out
    default:
      return value
    }
  }

  func rewriteFile(_ url: URL) throws -> Bool {
    let data = try Data(contentsOf: url)
    guard let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return false }
    let rewritten = value(parsed)
    guard !NSDictionary(dictionary: ["v": parsed]).isEqual(to: ["v": rewritten]) else { return false }
    let out = try JSONSerialization.data(withJSONObject: rewritten, options: [.fragmentsAllowed, .withoutEscapingSlashes])
    let mode = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions]) as? NSNumber)?.uint16Value ?? 0o644
    guard MigrationFiles.writeDurably(out, to: url, mode: mode_t(mode)) else { throw MigrationError("can't write \(url.lastPathComponent)") }
    return true
  }

  static func parses(_ url: URL) -> Bool {
    guard let data = try? Data(contentsOf: url) else { return false }
    if url.pathExtension == "plist" { return (try? PropertyListSerialization.propertyList(from: data, format: nil)) != nil }
    return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
  }
}

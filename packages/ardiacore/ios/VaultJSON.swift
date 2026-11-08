import Foundation

enum VaultJSON {
  private static let fractionalDates: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let internetDates: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  private static let civilDates: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    return formatter
  }()

  static func parse(_ data: Data) -> Any? {
    if let value = try? JSONSerialization.jsonObject(with: data, options: []) { return value }
    let opening = data.firstIndex { $0 == UInt8(ascii: "{") || $0 == UInt8(ascii: "[") }
    let closing = data.lastIndex { $0 == UInt8(ascii: "}") || $0 == UInt8(ascii: "]") }
    guard let opening, let closing, opening < closing else { return nil }
    return try? JSONSerialization.jsonObject(with: Data(data[opening...closing]), options: [])
  }

  static func dict(_ value: Any?) -> [String: Any]? { value as? [String: Any] }

  static func dicts(_ value: Any?) -> [[String: Any]] {
    guard let list = value as? [Any] else { return [] }
    return list.compactMap { $0 as? [String: Any] }
  }

  static func strings(_ value: Any?) -> [String] {
    guard let list = value as? [Any] else { return [] }
    return list.compactMap { string($0) }
  }

  static func string(_ value: Any?) -> String? {
    if let text = value as? String { return text.isEmpty ? nil : text }
    if let number = value as? NSNumber, !isBoolean(number) { return number.stringValue }
    return nil
  }

  static func bool(_ value: Any?) -> Bool? {
    guard let number = value as? NSNumber else { return nil }
    return number.boolValue
  }

  static func int(_ value: Any?) -> Int? {
    if let number = value as? NSNumber, !isBoolean(number), number.doubleValue.isFinite { return number.intValue }
    if let text = value as? String { return Int(text) }
    return nil
  }

  static func milliseconds(_ value: Any?) -> Double? {
    if let number = value as? NSNumber, !isBoolean(number) {
      let raw = number.doubleValue
      guard raw.isFinite, raw > 0 else { return nil }
      return raw > 100_000_000_000 ? raw : raw * 1000
    }
    guard let text = value as? String, !text.isEmpty else { return nil }
    let date = fractionalDates.date(from: text) ?? internetDates.date(from: text) ?? civilDates.date(from: String(text.prefix(19)))
    return date.map { ($0.timeIntervalSince1970 * 1000).rounded() }
  }

  static func object<T: Encodable>(_ value: T) -> [String: Any] {
    guard let data = try? JSONEncoder().encode(value), let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return [:]
    }
    return object
  }

  static func data(_ value: Any) -> Data? {
    guard JSONSerialization.isValidJSONObject(value) else { return nil }
    return try? JSONSerialization.data(withJSONObject: value)
  }

  static func text(_ value: Any) -> String {
    guard let data = data(value), let text = String(data: data, encoding: .utf8) else { return "{}" }
    return text
  }

  private static func isBoolean(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }
}

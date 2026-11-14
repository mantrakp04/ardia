import ArdiaBrowser
import Foundation

public enum AddressSecurity: Sendable, Equatable {
  case unknown
  case secure
  case mixed
  case insecure
}

public enum AddressGlyph: Sendable, Equatable {
  case favicon
  case lock
  case notSecure
  case privateBrowsing
  case globe
  case document
  case search

  public var symbolName: String? {
    switch self {
    case .favicon: nil
    case .lock: "lock.fill"
    case .notSecure: "exclamationmark.triangle.fill"
    case .privateBrowsing: "eyeglasses"
    case .globe: "globe"
    case .document: "doc"
    case .search: "magnifyingglass"
    }
  }
}

public struct AddressSummary: Sendable, Equatable {
  public enum Kind: Sendable, Equatable {
    case empty
    case web
    case file
    case other
  }

  public let kind: Kind
  public let glyph: AddressGlyph
  public let labelGlyph: AddressGlyph?
  public let text: String
  public let isPrivate: Bool
  public let isNotSecure: Bool

  public init(address: String, title: String, security: AddressSecurity, isPrivate: Bool, hasFavicon: Bool, placeholder: String) {
    let kind = Self.kind(of: address)
    let isNotSecure = kind == .other || kind == .web && (security == .insecure || security == .mixed || address.lowercased().hasPrefix("http://"))
    self.kind = kind
    self.isPrivate = isPrivate
    self.isNotSecure = isNotSecure
    self.text = Self.text(for: kind, address: address, title: title, placeholder: placeholder)
    let glyph = Self.glyph(for: kind, security: security, isPrivate: isPrivate, isNotSecure: isNotSecure, hasFavicon: hasFavicon)
    self.glyph = glyph
    self.labelGlyph = Self.labelGlyph(standing: glyph, isPrivate: isPrivate, isNotSecure: isNotSecure)
  }

  static func kind(of address: String) -> Kind {
    let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
    let lower = trimmed.lowercased()
    if trimmed.isEmpty || lower == "about:blank" || lower.hasPrefix(BrowserURL.browseScheme + ":") { return .empty }
    if BrowserURL.isSyncable(trimmed), BrowserURL.host(of: trimmed) != nil { return .web }
    if trimmed.lowercased().hasPrefix("file:") { return .file }
    return .other
  }

  static func text(for kind: Kind, address: String, title: String, placeholder: String) -> String {
    switch kind {
    case .empty:
      return placeholder
    case .web:
      return BrowserURL.host(of: address) ?? address
    case .file:
      let name = URL(string: address)?.lastPathComponent ?? ""
      return name.isEmpty ? (title.isEmpty ? address : title) : name
    case .other:
      return otherText(address)
    }
  }

  static func otherText(_ address: String) -> String {
    let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let colon = trimmed.firstIndex(of: ":") else { return trimmed }
    let scheme = trimmed[..<colon].lowercased()
    if scheme == "blob", let host = BrowserURL.host(of: String(trimmed[trimmed.index(after: colon)...])) { return host }
    return scheme
  }

  public var railGlyph: AddressGlyph {
    isPrivate ? .privateBrowsing : glyph
  }

  public var railBadge: AddressGlyph? {
    isPrivate && isNotSecure ? .notSecure : nil
  }

  static func glyph(for kind: Kind, security: AddressSecurity, isPrivate: Bool, isNotSecure: Bool, hasFavicon: Bool) -> AddressGlyph {
    if isNotSecure { return .notSecure }
    if isPrivate { return .privateBrowsing }
    switch kind {
    case .empty: return .search
    case .file: return .document
    case .other: return .globe
    case .web:
      if hasFavicon { return .favicon }
      return security == .secure ? .lock : .globe
    }
  }

  static func labelGlyph(standing glyph: AddressGlyph, isPrivate: Bool, isNotSecure: Bool) -> AddressGlyph? {
    if isPrivate { return .privateBrowsing }
    return isNotSecure ? nil : glyph
  }
}

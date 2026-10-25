import Foundation

struct HTMLAttributes: Sendable {
  private var pairs: [(name: String, value: String)] = []

  subscript(name: String) -> String? {
    pairs.first { $0.name == name }?.value
  }

  mutating func append(_ name: String, _ value: String) {
    if self[name] == nil { pairs.append((name, value)) }
  }

  var classTokens: [String] {
    let joined = [self["class"], self["id"]].compactMap(\.self).joined(separator: " ").lowercased()
    return joined.split { !$0.isLetter && !$0.isNumber }.map(String.init)
  }

  var classNames: Set<String> {
    Set((self["class"] ?? "").lowercased().split(whereSeparator: \.isWhitespace).map(String.init))
  }
}

enum HTMLToken: Sendable {
  case start(name: String, attributes: HTMLAttributes, selfClosing: Bool)
  case end(name: String)
  case text(String)
}

struct HTMLTokenizer: Sequence, IteratorProtocol {
  private static let rawTextElements: Set<String> = [
    "script", "style", "textarea", "title", "noscript", "iframe", "xmp", "noembed", "noframes", "template", "svg",
  ]
  private static let decodedRawTextElements: Set<String> = ["title", "textarea"]

  private let bytes: [UInt8]
  private var index = 0
  private var pendingRawText: String?
  private var queued: [HTMLToken] = []

  init(_ bytes: [UInt8]) {
    self.bytes = bytes
  }

  init(_ html: String) {
    self.init(Array(html.utf8))
  }

  mutating func next() -> HTMLToken? {
    if !queued.isEmpty { return queued.removeFirst() }
    if let element = pendingRawText {
      pendingRawText = nil
      return rawText(closing: element)
    }
    while index < bytes.count {
      if bytes[index] == UInt8(ascii: "<") {
        if let token = markup() { return token }
      } else {
        return text()
      }
    }
    return nil
  }

  private mutating func text() -> HTMLToken {
    let start = index
    while index < bytes.count, bytes[index] != UInt8(ascii: "<") { index += 1 }
    return .text(HTMLEntities.decode(String(decoding: bytes[start..<index], as: UTF8.self)))
  }

  private mutating func markup() -> HTMLToken? {
    let next = peek(1)
    if next == UInt8(ascii: "!") {
      if peek(2) == UInt8(ascii: "-"), peek(3) == UInt8(ascii: "-") {
        skip(past: Array("-->".utf8), from: index + 4)
      } else {
        skip(past: [UInt8(ascii: ">")], from: index + 2)
      }
      return nil
    }
    if next == UInt8(ascii: "?") {
      skip(past: [UInt8(ascii: ">")], from: index + 2)
      return nil
    }
    if next == UInt8(ascii: "/") {
      guard let first = peek(2), Self.isLetter(first) else {
        skip(past: [UInt8(ascii: ">")], from: index + 2)
        return nil
      }
      index += 2
      let name = readName()
      skip(past: [UInt8(ascii: ">")], from: index)
      return .end(name: name)
    }
    guard let first = next, Self.isLetter(first) else {
      index += 1
      return .text("<")
    }
    index += 1
    let name = readName()
    var attributes = HTMLAttributes()
    var selfClosing = false
    while index < bytes.count {
      skipWhitespace()
      guard index < bytes.count else { break }
      let byte = bytes[index]
      if byte == UInt8(ascii: ">") {
        index += 1
        break
      }
      if byte == UInt8(ascii: "/") {
        index += 1
        if peek(0) == UInt8(ascii: ">") {
          selfClosing = true
          index += 1
          break
        }
        continue
      }
      let attributeName = readAttributeName()
      if attributeName.isEmpty {
        index += 1
        continue
      }
      skipWhitespace()
      var value = ""
      if peek(0) == UInt8(ascii: "=") {
        index += 1
        skipWhitespace()
        value = HTMLEntities.decode(readAttributeValue())
      }
      attributes.append(attributeName, value)
    }
    if Self.rawTextElements.contains(name), !selfClosing {
      pendingRawText = name
    }
    return .start(name: name, attributes: attributes, selfClosing: selfClosing)
  }

  private mutating func rawText(closing element: String) -> HTMLToken {
    let start = index
    let closing = Array("</\(element)".utf8)
    var end = bytes.count
    var cursor = index
    while cursor + closing.count <= bytes.count {
      if bytes[cursor] == UInt8(ascii: "<"), matchesIgnoringCase(closing, at: cursor) {
        end = cursor
        break
      }
      cursor += 1
    }
    index = end
    if end < bytes.count {
      skip(past: [UInt8(ascii: ">")], from: end + closing.count)
    }
    let raw = String(decoding: bytes[start..<end], as: UTF8.self)
    queued.append(.end(name: element))
    return .text(Self.decodedRawTextElements.contains(element) ? HTMLEntities.decode(raw) : raw)
  }

  private func peek(_ offset: Int) -> UInt8? {
    let position = index + offset
    return position < bytes.count ? bytes[position] : nil
  }

  private mutating func skip(past terminator: [UInt8], from start: Int) {
    var cursor = start
    while cursor + terminator.count <= bytes.count {
      if bytes[cursor] == terminator[0], Array(bytes[cursor..<(cursor + terminator.count)]) == terminator {
        index = cursor + terminator.count
        return
      }
      cursor += 1
    }
    index = bytes.count
  }

  private func matchesIgnoringCase(_ pattern: [UInt8], at position: Int) -> Bool {
    for offset in 0..<pattern.count where Self.lowercased(bytes[position + offset]) != pattern[offset] {
      return false
    }
    return true
  }

  private mutating func skipWhitespace() {
    while index < bytes.count, Self.isWhitespace(bytes[index]) { index += 1 }
  }

  private mutating func readName() -> String {
    let start = index
    while index < bytes.count {
      let byte = bytes[index]
      if Self.isWhitespace(byte) || byte == UInt8(ascii: ">") || byte == UInt8(ascii: "/") { break }
      index += 1
    }
    return String(decoding: bytes[start..<index].map(Self.lowercased), as: UTF8.self)
  }

  private mutating func readAttributeName() -> String {
    let start = index
    while index < bytes.count {
      let byte = bytes[index]
      if Self.isWhitespace(byte) || byte == UInt8(ascii: "=") || byte == UInt8(ascii: ">") || byte == UInt8(ascii: "/") {
        break
      }
      index += 1
    }
    return String(decoding: bytes[start..<index].map(Self.lowercased), as: UTF8.self)
  }

  private mutating func readAttributeValue() -> String {
    guard let quote = peek(0) else { return "" }
    if quote == UInt8(ascii: "\"") || quote == UInt8(ascii: "'") {
      index += 1
      let start = index
      while index < bytes.count, bytes[index] != quote { index += 1 }
      let value = String(decoding: bytes[start..<index], as: UTF8.self)
      if index < bytes.count { index += 1 }
      return value
    }
    let start = index
    while index < bytes.count, !Self.isWhitespace(bytes[index]), bytes[index] != UInt8(ascii: ">") { index += 1 }
    return String(decoding: bytes[start..<index], as: UTF8.self)
  }

  private static func isLetter(_ byte: UInt8) -> Bool {
    (byte >= UInt8(ascii: "a") && byte <= UInt8(ascii: "z")) || (byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z"))
  }

  private static func isWhitespace(_ byte: UInt8) -> Bool {
    byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D || byte == 0x0C
  }

  private static func lowercased(_ byte: UInt8) -> UInt8 {
    byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z") ? byte + 32 : byte
  }
}

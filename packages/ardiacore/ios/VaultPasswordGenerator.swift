import Foundation
import Security

enum VaultPasswordStyle: String, Sendable {
  case strong
  case alphanumeric
  case easyToType
  case passphrase

  init(named name: String?) {
    self = name.flatMap(VaultPasswordStyle.init(rawValue:)) ?? .strong
  }
}

enum VaultPasswordGenerator {
  static let groups = 4
  static let groupLength = 5
  static let separator: Character = "-"
  static let alphanumericLength = 20
  static let passphraseWords = 5
  static let shortestPassphraseWords = 4
  static var length: Int { groupedLength(groups) }

  private struct Rule {
    let characters: Set<Character>
    let count: Int
  }

  private static let lowercase = Array("abcdefghijkmnpqrstuvwxyz")
  private static let uppercase = Array("ABCDEFGHJKLMNPQRSTUVWXYZ")
  private static let digits = Array("23456789")
  private static let passphraseAttempts = 64

  static func generate(style: VaultPasswordStyle = .strong, maxLength: Int? = nil) -> String {
    let limit = maxLength.flatMap { $0 > 0 ? $0 : nil }
    switch style {
    case .strong:
      return grouped(alphabet: lowercase + uppercase + digits, rules: mixedRules, limit: limit)
    case .alphanumeric:
      return alphanumeric(min(limit ?? alphanumericLength, alphanumericLength))
    case .easyToType:
      return grouped(alphabet: lowercase + digits, rules: easyRules, limit: limit)
    case .passphrase:
      return passphrase(limit: limit)
    }
  }

  private static var mixedRules: [Rule] {
    [Rule(characters: Set(uppercase), count: 1), Rule(characters: Set(lowercase), count: 1), Rule(characters: Set(digits), count: 1)]
  }

  private static var easyRules: [Rule] {
    [Rule(characters: Set(digits), count: 2), Rule(characters: Set(lowercase), count: 1)]
  }

  private static func groupedLength(_ count: Int) -> Int { count * groupLength + count - 1 }

  private static func alphanumeric(_ count: Int) -> String {
    String(characters(count, from: lowercase + uppercase + digits, rules: mixedRules))
  }

  private static func grouped(alphabet: [Character], rules: [Rule], limit: Int?) -> String {
    let natural = groupedLength(groups)
    guard let limit, limit < natural else { return joinedGroups(characters(groups * groupLength, from: alphabet, rules: rules)) }
    if let fitting = (2..<groups).reversed().first(where: { groupedLength($0) == limit }) {
      return joinedGroups(characters(fitting * groupLength, from: alphabet, rules: rules))
    }
    return String(characters(limit, from: alphabet, rules: rules))
  }

  private static func joinedGroups(_ characters: [Character]) -> String {
    stride(from: 0, to: characters.count, by: groupLength)
      .map { String(characters[$0..<min($0 + groupLength, characters.count)]) }
      .joined(separator: String(separator))
  }

  private static func passphrase(limit: Int?) -> String {
    guard let limit else { return phrase(words: passphraseWords) }
    for count in [passphraseWords, shortestPassphraseWords] {
      for _ in 0..<passphraseAttempts {
        let candidate = phrase(words: count)
        if candidate.count <= limit { return candidate }
      }
    }
    return alphanumeric(min(limit, alphanumericLength))
  }

  private static func phrase(words count: Int) -> String {
    let list = VaultWordList.words
    var words = (0..<count).map { _ in list[randomIndex(below: list.count)] }
    let capitalized = randomIndex(below: count)
    words[capitalized] = words[capitalized].prefix(1).uppercased() + words[capitalized].dropFirst()
    let numbered = randomIndex(below: count)
    words[numbered].append(digits[randomIndex(below: digits.count)])
    return words.joined(separator: String(separator))
  }

  private static func characters(_ count: Int, from alphabet: [Character], rules: [Rule]) -> [Character] {
    let wanted = fitted(rules, into: count)
    while true {
      let picked = (0..<count).map { _ in alphabet[randomIndex(below: alphabet.count)] }
      if wanted.allSatisfy({ rule in picked.filter { rule.characters.contains($0) }.count >= rule.count }) { return picked }
    }
  }

  private static func fitted(_ rules: [Rule], into count: Int) -> [Rule] {
    var counts = rules.map(\.count)
    while counts.reduce(0, +) > count, let largest = counts.indices.max(by: { counts[$0] < counts[$1] }) {
      counts[largest] -= 1
    }
    return zip(rules, counts).compactMap { rule, count in count > 0 ? Rule(characters: rule.characters, count: count) : nil }
  }

  private static func randomIndex(below bound: Int) -> Int {
    guard bound > 1 else { return 0 }
    let span = UInt64(UInt32.max) + 1
    let limit = span - span % UInt64(bound)
    while true {
      var value: UInt32 = 0
      let status = withUnsafeMutableBytes(of: &value) { buffer in
        SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
      }
      if status != errSecSuccess {
        var fallback = SystemRandomNumberGenerator()
        return Int.random(in: 0..<bound, using: &fallback)
      }
      if UInt64(value) < limit { return Int(UInt64(value) % UInt64(bound)) }
    }
  }
}

import Foundation
import Security

enum VaultPasswordGenerator {
  static let groups = 4
  static let groupLength = 5
  static let separator: Character = "-"
  static var length: Int { groups * groupLength + groups - 1 }

  private static let lowercase = Array("abcdefghijkmnopqrstuvwxyz".filter { $0 != "o" })
  private static let uppercase = Array("ABCDEFGHJKLMNPQRSTUVWXYZ")
  private static let digits = Array("23456789")

  static func generate() -> String {
    let alphabet = lowercase + uppercase + digits
    while true {
      let characters = (0..<(groups * groupLength)).map { _ in alphabet[randomIndex(below: alphabet.count)] }
      guard characters.contains(where: { uppercase.contains($0) }), characters.contains(where: { digits.contains($0) }),
        characters.contains(where: { lowercase.contains($0) })
      else { continue }
      return stride(from: 0, to: characters.count, by: groupLength)
        .map { String(characters[$0..<($0 + groupLength)]) }
        .joined(separator: String(separator))
    }
  }

  private static func randomIndex(below bound: Int) -> Int {
    let limit = 256 - 256 % bound
    while true {
      var byte: UInt8 = 0
      if SecRandomCopyBytes(kSecRandomDefault, 1, &byte) != errSecSuccess {
        var fallback = SystemRandomNumberGenerator()
        return Int.random(in: 0..<bound, using: &fallback)
      }
      if Int(byte) < limit { return Int(byte) % bound }
    }
  }
}

import Foundation

public enum ResearchAnswer {
  public enum Block: Equatable, Hashable, Sendable {
    case heading(String)
    case bullet(String)
    case paragraph(String)

    public var text: String {
      switch self {
      case .heading(let text), .bullet(let text), .paragraph(let text): text
      }
    }
  }

  public static func blocks(_ answer: String) -> [Block] {
    answer.split(whereSeparator: \.isNewline).compactMap { rawLine in
      let line = rawLine.trimmingCharacters(in: .whitespaces)
      if line.isEmpty { return nil }
      if let heading = stripping(line, prefixes: ["### ", "## ", "# "]) {
        let text = unbolded(heading)
        return text.isEmpty ? nil : .heading(text)
      }
      if var bullet = stripping(line, prefixes: bulletPrefixes) {
        while let inner = stripping(bullet, prefixes: bulletPrefixes) { bullet = inner }
        let text = unbolded(bullet)
        return text.isEmpty ? nil : .bullet(text)
      }
      let text = unbolded(line)
      if text.hasSuffix(":"), text.count < 60, !text.contains(". ") { return .heading(String(text.dropLast())) }
      return .paragraph(text)
    }
  }

  public static func citations(in text: String) -> [Int] {
    var found: [Int] = []
    for match in text.matches(of: citationPattern) {
      for number in match.output.1.split(separator: ",").compactMap({ Int($0.trimmingCharacters(in: .whitespaces)) })
      where !found.contains(number) {
        found.append(number)
      }
    }
    return found
  }

  public static func withoutCitations(_ text: String) -> String {
    text.replacing(spacedCitationPattern, with: "")
  }

  public static func spoken(_ answer: String) -> String {
    blocks(answer).map { block in
      let text = withoutCitations(block.text).trimmingCharacters(in: .whitespaces)
      guard let last = text.last else { return "" }
      return ".!?:".contains(last) ? text : text + "."
    }
    .filter { !$0.isEmpty }
    .joined(separator: "\n")
  }

  static let bulletPrefixes = ["- ", "* ", "• ", "– "]

  public static func citationRuns(in text: String) -> [(range: Range<String.Index>, numbers: [Int])] {
    text.matches(of: citationRunPattern).map { match in
      (match.range, citations(in: String(match.output.1)))
    }
  }

  nonisolated(unsafe) static let citationRunPattern = /\s*((?:\[\d{1,2}(?:\s*,\s*\d{1,2})*\])+)/
  nonisolated(unsafe) static let citationPattern = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/
  nonisolated(unsafe) static let spacedCitationPattern = /\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/

  static func stripping(_ line: String, prefixes: [String]) -> String? {
    for prefix in prefixes where line.hasPrefix(prefix) {
      return String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    }
    return nil
  }

  static func unbolded(_ text: String) -> String {
    text.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "__", with: "").trimmingCharacters(in: .whitespaces)
  }
}

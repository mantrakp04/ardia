import Foundation
import NaturalLanguage

struct SentenceRun: Equatable {
  let text: String
  let gap: String
}

enum SentenceRuns {
  static let defaultLimit = 800

  static func split(_ text: String, limit: Int = defaultLimit) -> [SentenceRun] {
    guard text.count > limit else { return [SentenceRun(text: text, gap: "")] }
    return chunks(text, limit: max(1, limit), units: [.sentence, .word]).map(run)
  }

  private static func chunks(_ text: String, limit: Int, units: ArraySlice<NLTokenUnit>) -> [String] {
    guard text.count > limit else { return [text] }
    guard let unit = units.first else { return graphemes(text, limit: limit) }
    var out: [String] = []
    var current = ""
    for segment in segments(text, unit: unit) {
      if segment.count > limit {
        if !current.isEmpty { out.append(current) }
        current = ""
        out += chunks(segment, limit: limit, units: units.dropFirst())
        continue
      }
      if !current.isEmpty, current.count + segment.count > limit {
        out.append(current)
        current = ""
      }
      current += segment
    }
    if !current.isEmpty { out.append(current) }
    return out
  }

  private static func segments(_ text: String, unit: NLTokenUnit) -> [String] {
    let tokenizer = NLTokenizer(unit: unit)
    tokenizer.string = text
    var out: [String] = []
    var start = text.startIndex
    tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
      if range.lowerBound > start {
        out.append(String(text[start..<range.lowerBound]))
        start = range.lowerBound
      }
      return true
    }
    out.append(String(text[start...]))
    return out
  }

  private static func graphemes(_ text: String, limit: Int) -> [String] {
    var out: [String] = []
    var index = text.startIndex
    while index < text.endIndex {
      let end = text.index(index, offsetBy: limit, limitedBy: text.endIndex) ?? text.endIndex
      out.append(String(text[index..<end]))
      index = end
    }
    return out
  }

  private static func run(_ chunk: String) -> SentenceRun {
    let body = chunk.reversed().drop(while: \.isWhitespace).reversed()
    let text = String(body)
    return SentenceRun(text: text, gap: String(chunk.dropFirst(text.count)))
  }
}

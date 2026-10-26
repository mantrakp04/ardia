import Foundation
import NaturalLanguage

enum QuotePicker {
  static let length = 60...220

  static func pick(for query: String, from pages: [(source: Int, page: ReadablePage)]) -> BrowseQuote? {
    let wanted = Set(keywords(in: query))
    guard !wanted.isEmpty else { return nil }
    var best: (score: Int, quote: BrowseQuote)?
    for (rank, entry) in pages.enumerated() {
      for block in entry.page.blocks where block.kind == .paragraph || block.kind == .quote {
        for sentence in sentences(in: block.text) where isQuotable(sentence) {
          let hits = Set(keywords(in: sentence)).intersection(wanted).count
          guard hits > 0 else { continue }
          let score = hits * 10 - rank
          if score > (best?.score ?? .min) {
            best = (score, BrowseQuote(text: sentence, source: entry.source))
          }
        }
      }
    }
    return best?.quote
  }

  static func keywords(in text: String) -> [String] {
    text.lowercased()
      .split { !$0.isLetter && !$0.isNumber }
      .map(String.init)
      .filter { $0.count > 2 && !stopWords.contains($0) }
      .map { $0.count > 3 && $0.hasSuffix("s") && !$0.hasSuffix("ss") ? String($0.dropLast()) : $0 }
  }

  private static func sentences(in text: String) -> [String] {
    let tokenizer = NLTokenizer(unit: .sentence)
    tokenizer.string = text
    return tokenizer.tokens(for: text.startIndex..<text.endIndex).map {
      text[$0].trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }

  private static func isQuotable(_ sentence: String) -> Bool {
    guard length.contains(sentence.count), let first = sentence.first, first.isUppercase,
      let last = sentence.last, ".!".contains(last)
    else { return false }
    let banned: [Character] = ["[", "]", "{", "}", "|", "\u{201C}", "\u{201D}", "\""]
    return !sentence.contains { banned.contains($0) } && !sentence.contains("http")
  }

  private static let stopWords: Set<String> = [
    "the", "and", "for", "are", "was", "what", "who", "how", "why", "when", "where", "which", "does", "with", "that",
    "this", "there", "their", "they", "from", "about", "into", "can", "you", "your", "best", "should", "would",
    "could", "will", "have", "has", "had", "not", "but", "all", "any", "its", "out", "use", "get", "one",
  ]
}

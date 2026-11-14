import Foundation

public struct ResearchSource: Identifiable, Equatable, Hashable, Sendable {
  public var id: Int
  public var url: URL
  public var title: String
  public var siteName: String
  public var paragraphs: [String]

  public init(id: Int, url: URL, title: String, siteName: String, paragraphs: [String]) {
    self.id = id
    self.url = url
    self.title = title
    self.siteName = siteName
    self.paragraphs = paragraphs
  }

  public var characterCount: Int { paragraphs.reduce(0) { $0 + $1.count } }
}

public enum ResearchDigest {
  public static let minimumSourceCharacters = 300
  public static let extractiveLineLimit = 6

  public static let instructions = """
    You answer a search query using only the numbered web pages you are given. \
    Start with a one or two sentence direct answer. Then add up to three short sections, each a line starting with "## " \
    followed by two to four lines starting with "- ". Keep every line short and plain, as if read aloud. \
    After each fact put the number of the page it came from in brackets, like [2]. \
    If the pages don't answer the query, say so in one sentence. Never invent facts or links.
    """

  static let stopWords: Set<String> = [
    "the", "and", "for", "are", "was", "what", "when", "where", "which", "who", "why", "how", "does", "did", "with",
    "this", "that", "from", "about", "into", "your", "you", "can", "best", "is", "of", "to", "in", "on", "a", "an",
    "do", "it", "be", "or", "at", "by", "vs", "my", "me", "i",
  ]

  public static func terms(_ query: String) -> Set<String> {
    Set(
      query.lowercased()
        .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        .map(String.init)
        .filter { ($0.count >= 3 || $0.allSatisfy(\.isNumber)) && !stopWords.contains($0) }
    )
  }

  static func score(_ text: String, terms: Set<String>) -> Int {
    guard !terms.isEmpty else { return 0 }
    let words = text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    let hits = words.reduce(0) { $0 + (terms.contains($1) ? 1 : 0) }
    let distinct = terms.intersection(words).count
    return hits + distinct * 3
  }

  public static func excerpt(_ paragraphs: [String], query: String, characterBudget: Int) -> String {
    guard characterBudget > 0 else { return "" }
    let terms = terms(query)
    let ranked = paragraphs.enumerated()
      .filter { $0.element.count >= 40 }
      .map { (index: $0.offset, text: $0.element, score: score($0.element, terms: terms) + ($0.offset == 0 ? 2 : 0)) }
      .sorted { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }
    var chosen: [(index: Int, text: String)] = []
    var used = 0
    for paragraph in ranked {
      let remaining = characterBudget - used
      if remaining < 80 { break }
      let text = paragraph.text.count > remaining ? clipped(paragraph.text, to: remaining) : paragraph.text
      chosen.append((paragraph.index, text))
      used += text.count + 1
    }
    return chosen.sorted { $0.index < $1.index }.map(\.text).joined(separator: "\n")
  }

  static func clipped(_ text: String, to limit: Int) -> String {
    let prefix = String(text.prefix(limit))
    if let end = prefix.lastIndex(where: { ".!?".contains($0) }), prefix.distance(from: prefix.startIndex, to: end) > limit / 2 {
      return String(prefix[...end])
    }
    return prefix
  }

  public static func prompt(query: String, sources: [ResearchSource], characterBudget: Int) -> String {
    let perSource = sources.isEmpty ? 0 : characterBudget / sources.count
    let pages = sources.map { source in
      "[\(source.id)] \(source.title) (\(source.siteName))\n" + excerpt(source.paragraphs, query: query, characterBudget: perSource)
    }
    return "Query: \(query)\n\nPages:\n\n" + pages.joined(separator: "\n\n") + "\n\nAnswer the query: \(query)"
  }

  public static func extractiveAnswer(query: String, sources: [ResearchSource]) -> String {
    let terms = terms(query)
    var candidates: [(source: Int, rank: Int, text: String, score: Int)] = []
    for source in sources {
      for (rank, sentence) in sentences(in: source.paragraphs.prefix(40)).enumerated() where (40...320).contains(sentence.count) {
        candidates.append((source.id, rank, sentence, score(sentence, terms: terms) - rank / 8))
      }
    }
    var lines: [String] = []
    var seen: Set<String> = []
    for candidate in candidates.sorted(by: { $0.score != $1.score ? $0.score > $1.score : ($0.source, $0.rank) < ($1.source, $1.rank) }) {
      let key = String(candidate.text.lowercased().prefix(60))
      guard seen.insert(key).inserted else { continue }
      lines.append("- \(candidate.text) [\(candidate.source)]")
      if lines.count == extractiveLineLimit { break }
    }
    return lines.joined(separator: "\n")
  }

  static func sentences(in paragraphs: some Sequence<String>) -> [String] {
    var result: [String] = []
    for paragraph in paragraphs {
      paragraph.enumerateSubstrings(in: paragraph.startIndex..., options: [.bySentences, .localized]) { substring, _, _, _ in
        if let sentence = substring?.trimmingCharacters(in: .whitespacesAndNewlines), !sentence.isEmpty { result.append(sentence) }
      }
    }
    return result
  }
}

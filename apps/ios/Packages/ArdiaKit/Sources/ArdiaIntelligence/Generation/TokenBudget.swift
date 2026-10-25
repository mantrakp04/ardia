import Foundation
import NaturalLanguage

public enum TokenEstimate {
  public static func tokens(in text: String) -> Int {
    var weight = 0.0
    for scalar in text.unicodeScalars {
      switch scalar.value {
      case 0..<0x80: weight += 1.0 / 3.6
      case 0x80..<0x800: weight += 1.0 / 2.2
      default: weight += 1.0
      }
    }
    return Int(weight.rounded(.up))
  }

  public static func prefix(of text: String, fittingTokens limit: Int) -> String {
    guard tokens(in: text) > limit else { return text }
    var weight = 0.0
    var end = text.startIndex
    for index in text.unicodeScalars.indices {
      let value = text.unicodeScalars[index].value
      weight += value < 0x80 ? 1.0 / 3.6 : value < 0x800 ? 1.0 / 2.2 : 1.0
      if weight > Double(limit) { break }
      end = text.unicodeScalars.index(after: index)
    }
    let cut = text[..<end]
    if let sentenceEnd = cut.lastIndex(where: { ".!?\u{3002}".contains($0) }), cut.distance(from: cut.startIndex, to: sentenceEnd) > cut.count / 2 {
      return String(cut[...sentenceEnd])
    }
    if let space = cut.lastIndex(where: \.isWhitespace) {
      return String(cut[..<space]) + "\u{2026}"
    }
    return String(cut)
  }
}

struct QueryTerms: Sendable {
  private static let stopWords: Set<String> = [
    "the", "and", "for", "how", "what", "why", "when", "where", "which", "who", "whom", "does", "did", "with", "from",
    "that", "this", "these", "those", "are", "was", "were", "can", "could", "should", "would", "you", "your", "into",
    "about", "near", "than", "then", "there", "their", "they", "them", "have", "has", "had", "its", "not", "but",
    "all", "any", "some", "much", "many", "more", "most", "best", "good", "make", "made", "way", "ways", "get",
    "is", "of", "to", "in", "on", "a", "an", "or", "do", "be", "it", "at", "by", "as", "vs", "versus", "me", "my", "i",
  ]

  let stems: [String]

  init(_ query: String) {
    var seen: Set<String> = []
    stems = Self.words(in: query).compactMap { word in
      guard !Self.stopWords.contains(word), word.count >= 2 || word.unicodeScalars.contains(where: { $0.value >= 0x800 })
      else { return nil }
      let stem = Self.stem(word)
      return seen.insert(stem).inserted ? stem : nil
    }
  }

  static func words(in text: String) -> [String] {
    let tokenizer = NLTokenizer(unit: .word)
    let lowered = text.lowercased()
    tokenizer.string = lowered
    return tokenizer.tokens(for: lowered.startIndex..<lowered.endIndex).map { String(lowered[$0]) }
  }

  static func stem(_ word: String) -> String {
    for suffix in ["ies", "es", "s", "ing", "ed"] where word.count > suffix.count + 3 && word.hasSuffix(suffix) {
      return String(word.dropLast(suffix.count))
    }
    return word
  }

  func relevance(of text: String) -> Double {
    guard !stems.isEmpty else { return 0 }
    let words = Set(Self.words(in: text).map(Self.stem))
    let hits = stems.filter { stem in words.contains { $0.hasPrefix(stem) || stem.hasPrefix($0) && $0.count >= 4 } }
    return Double(hits.count) / Double(stems.count)
  }
}

enum PassageSelector {
  static let longBlockCharacters = 1_200

  static func split(_ blocks: [TextBlock]) -> [TextBlock] {
    blocks.flatMap { block -> [TextBlock] in
      guard block.text.count > longBlockCharacters else { return [block] }
      let tokenizer = NLTokenizer(unit: .sentence)
      tokenizer.string = block.text
      var pieces: [TextBlock] = []
      var current = ""
      for range in tokenizer.tokens(for: block.text.startIndex..<block.text.endIndex) {
        let sentence = block.text[range].trimmingCharacters(in: .whitespacesAndNewlines)
        if current.count + sentence.count > longBlockCharacters / 2, !current.isEmpty {
          pieces.append(TextBlock(kind: block.kind, text: current, group: block.group))
          current = ""
        }
        current += current.isEmpty ? sentence : " " + sentence
      }
      if !current.isEmpty { pieces.append(TextBlock(kind: block.kind, text: current, group: block.group)) }
      return pieces
    }
  }

  static func select(_ blocks: [TextBlock], terms: QueryTerms, tokenLimit: Int) -> [TextBlock] {
    let pieces = split(blocks)
    guard tokenLimit > 0, !pieces.isEmpty else { return [] }
    let costs = pieces.map { TokenEstimate.tokens(in: $0.text) + 1 }
    if costs.reduce(0, +) <= tokenLimit { return pieces }

    var scores = pieces.map { terms.relevance(of: $0.text) * 3 }
    var leadRank = 0
    for index in pieces.indices where pieces[index].kind != .heading && leadRank < 3 {
      scores[index] += [1.0, 0.6, 0.3][leadRank]
      leadRank += 1
    }
    var groupBest: [Int: Double] = [:]
    for index in pieces.indices where pieces[index].kind == .listItem && pieces[index].group > 0 {
      groupBest[pieces[index].group] = max(groupBest[pieces[index].group] ?? 0, scores[index])
    }
    for index in pieces.indices where pieces[index].kind == .listItem && pieces[index].group > 0 {
      scores[index] += (groupBest[pieces[index].group] ?? 0) * 0.7
    }

    let order = pieces.indices.sorted { left, right in
      let leftValue = scores[left] / Double(costs[left]).squareRoot()
      let rightValue = scores[right] / Double(costs[right]).squareRoot()
      return leftValue == rightValue ? left < right : leftValue > rightValue
    }
    var chosen: Set<Int> = []
    var used = 0
    for index in order where pieces[index].kind != .heading {
      if used + costs[index] <= tokenLimit {
        chosen.insert(index)
        used += costs[index]
      } else if chosen.isEmpty {
        return [TextBlock(kind: pieces[index].kind, text: TokenEstimate.prefix(of: pieces[index].text, fittingTokens: tokenLimit), group: pieces[index].group)]
      }
    }
    for index in chosen.sorted() {
      guard let heading = pieces[..<index].lastIndex(where: { $0.kind == .heading }), !chosen.contains(heading) else { continue }
      if used + costs[heading] <= tokenLimit {
        chosen.insert(heading)
        used += costs[heading]
      }
    }
    return chosen.sorted().map { pieces[$0] }
  }
}

enum TokenAllocator {
  static func fairShares(demands: [Int], total: Int) -> [Int] {
    var shares = Array(repeating: 0, count: demands.count)
    var remaining = max(0, total)
    var open = Set(demands.indices)
    while !open.isEmpty, remaining > 0 {
      let share = remaining / open.count
      guard share > 0 else { break }
      let satisfied = open.filter { demands[$0] - shares[$0] <= share }
      if satisfied.isEmpty {
        for index in open { shares[index] += share }
        remaining -= share * open.count
        break
      }
      for index in satisfied {
        remaining -= demands[index] - shares[index]
        shares[index] = demands[index]
        open.remove(index)
      }
    }
    return shares
  }
}

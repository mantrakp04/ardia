import Foundation

enum LinkedPieces {
  static func text(_ pieces: [String]) -> AttributedString {
    var text = AttributedString()
    for (i, piece) in pieces.enumerated() {
      var run = AttributedString(piece)
      run.link = URL(string: "ac-piece:\(i)")
      text += run
    }
    return text
  }

  static func parts(of translated: AttributedString, over pieces: [String]) -> [String]? {
    var parts = Array(repeating: "", count: pieces.count)
    var tagged = Array(repeating: false, count: pieces.count)
    var last: Int?
    var lead = ""
    for run in translated.runs {
      let words = String(translated[run.range].characters)
      guard let link = run.link else {
        if let last { parts[last] += words } else { lead += words }
        continue
      }
      guard link.scheme == "ac-piece", let i = Int(link.absoluteString.dropFirst("ac-piece:".count)), parts.indices.contains(i) else { return nil }
      if last == nil {
        parts[i] += lead
        lead = ""
      }
      tagged[i] = true
      parts[i] += words
      last = i
    }
    guard !tagged.contains(false), !parts.contains(where: { $0.allSatisfy(\.isWhitespace) }) else { return nil }
    return parts
  }
}

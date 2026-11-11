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
    var order: [Int] = []
    for run in translated.runs {
      let words = String(translated[run.range].characters)
      if let link = run.link {
        guard link.scheme == "ac-piece", let i = Int(link.absoluteString.dropFirst("ac-piece:".count)), parts.indices.contains(i) else { return nil }
        if order.last != i { order.append(i) }
        parts[i] += words
      } else {
        parts[order.last ?? 0] += words
      }
    }
    guard Set(order).count == pieces.count else { return nil }
    guard order != Array(order.sorted()) || order.count != pieces.count else { return parts }
    let shared = distribute(String(translated.characters), over: pieces)
    return shared.contains(where: \.isEmpty) ? nil : shared
  }

  static func distribute(_ text: String, over pieces: [String]) -> [String] {
    let chars = Array(text)
    let total = max(1, pieces.reduce(0) { $0 + $1.count })
    var out: [String] = []
    var start = 0
    var seen = 0
    for (i, piece) in pieces.enumerated() {
      seen += piece.count
      var end = i == pieces.count - 1 ? chars.count : min(chars.count, Int((Double(seen) / Double(total) * Double(chars.count)).rounded()))
      if end < chars.count, end > start {
        let window = 12
        if let space = (0...window).lazy.flatMap({ [end + $0, end - $0] }).first(where: { $0 > start && $0 < chars.count && chars[$0] == " " }) {
          end = space + 1
        }
      }
      end = max(start, end)
      out.append(String(chars[start..<end]))
      start = end
    }
    return out
  }
}

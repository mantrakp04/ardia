import Foundation

enum PassageDispatch {
  @MainActor
  static func translate(
    _ pieces: [String],
    limit: Int = SentenceRuns.defaultLimit,
    plain: (String) async -> String?,
    linked: (([String]) async -> [String]?)?
  ) async -> [String]? {
    guard !pieces.isEmpty else { return [] }
    if pieces.count == 1 { return await runs(pieces[0], limit: limit, plain).map { [$0] } }
    guard let linked else { return nil }
    guard pieces.reduce(0, { $0 + $1.count }) > limit else { return await linked(pieces) }
    var out: [String] = []
    for group in groups(pieces, limit: limit) {
      if Task.isCancelled { return nil }
      let slice = Array(pieces[group])
      if slice.count == 1 {
        guard let translated = await runs(slice[0], limit: limit, plain) else { return nil }
        out.append(translated)
      } else {
        guard let parts = await linked(slice), parts.count == slice.count else { return nil }
        out += parts
      }
    }
    return out
  }

  static func groups(_ pieces: [String], limit: Int) -> [Range<Int>] {
    var out: [Range<Int>] = []
    var start = 0
    var size = 0
    for (i, piece) in pieces.enumerated() {
      if i > start, size + piece.count > limit {
        out.append(start..<i)
        start = i
        size = 0
      }
      size += piece.count
    }
    out.append(start..<pieces.count)
    return out
  }

  @MainActor
  private static func runs(_ text: String, limit: Int, _ plain: (String) async -> String?) async -> String? {
    var out = ""
    for piece in SentenceRuns.split(text, limit: limit) {
      if Task.isCancelled { return nil }
      guard !piece.text.isEmpty else {
        out += piece.gap
        continue
      }
      guard let translated = await plain(piece.text) else { return nil }
      out += translated + piece.gap
    }
    return out
  }
}

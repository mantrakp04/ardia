import Foundation

enum PageMarkup {
  static func overview(_ text: String) -> BrowsePageDraft {
    var draft = BrowsePageDraft()
    var answerLines: [String] = []
    for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = clean(String(rawLine))
      if let value = value(of: "title", in: line) {
        draft.title = value
      } else if let value = value(of: "answer", in: line) {
        answerLines = value.isEmpty ? [] : [value]
      } else if line.isEmpty {
        continue
      } else if draft.title == nil, answerLines.isEmpty {
        draft.title = line
      } else {
        answerLines.append(line)
      }
    }
    if !answerLines.isEmpty { draft.answer = answerLines.joined(separator: " ") }
    return draft
  }

  static func sections(_ text: String) -> BrowsePageDraft {
    var draft = BrowsePageDraft()
    var readingFollowUps = false
    for rawLine in text.split(separator: "\n") {
      let line = rawLine.trimmingCharacters(in: .whitespaces)
      guard !line.isEmpty else { continue }
      let unbolded = clean(line)
      if value(of: "next", in: unbolded) != nil || unbolded.lowercased().hasPrefix("follow") {
        readingFollowUps = true
        continue
      }
      if readingFollowUps || line.hasPrefix("?") {
        let question = stripMarker(unbolded)
          .trimmingCharacters(in: CharacterSet(charactersIn: "? ").union(.whitespaces))
        if !question.isEmpty { draft.followUps.append(question.hasSuffix("?") ? question : question + "?") }
        continue
      }
      if line.hasPrefix("#") {
        draft.sections.append(.init(heading: clean(String(line.drop { $0 == "#" }))))
      } else if isBullet(line) {
        if draft.sections.isEmpty { draft.sections.append(.init(heading: nil)) }
        draft.sections[draft.sections.count - 1].bullets.append(bullet(stripMarker(line)))
      } else if line.hasPrefix("**"), line.hasSuffix("**"), line.count > 4 {
        draft.sections.append(.init(heading: clean(line)))
      } else if let last = draft.sections.indices.last, let bulletIndex = draft.sections[last].bullets.indices.last {
        let existing = draft.sections[last].bullets[bulletIndex].text ?? ""
        draft.sections[last].bullets[bulletIndex].text = existing.isEmpty ? unbolded : existing + " " + unbolded
      }
    }
    return draft
  }

  static func bullet(_ body: String) -> BrowsePageDraft.Bullet {
    var rest = Substring(body.trimmingCharacters(in: .whitespaces))
    var emoji = ""
    if let first = rest.first, first.unicodeScalars.first?.properties.isEmoji == true,
      first.unicodeScalars.first.map({ $0.properties.isEmojiPresentation || first.unicodeScalars.count > 1 }) == true
    {
      emoji = String(first)
      rest = rest.dropFirst().drop { $0 == " " }
    }
    var lead = ""
    var text = clean(String(rest))
    for label in ["Sources:", "Source:", "Point:"] where text.hasPrefix(label) {
      text = String(text.dropFirst(label.count)).trimmingCharacters(in: .whitespaces)
    }
    var sentence = text
    if let colon = text.firstIndex(of: ":") {
      let candidate = text[..<colon].trimmingCharacters(in: .whitespaces)
      if !candidate.isEmpty, candidate.split(separator: " ").count <= 5, !candidate.contains("[") {
        lead = candidate.prefix(1).uppercased() + candidate.dropFirst()
        sentence = String(text[text.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
      }
    }
    let cited = trailingCitations(sentence)
    let stripped = Citations.strip(cited.text)
    let sources = Array(Set(cited.numbers + stripped.numbers)).sorted()
    return BrowsePageDraft.Bullet(emoji: emoji, lead: lead, text: stripped.text, sources: sources)
  }

  static func points(_ strings: [String]) -> [BrowsePageDraft.Bullet] {
    var bullets: [BrowsePageDraft.Bullet] = []
    for string in strings {
      if !string.contains(where: \.isLetter), let last = bullets.indices.last {
        let numbers = string.split { !$0.isNumber }.compactMap { Int($0) }
        bullets[last].sources = Array(Set(bullets[last].sources + numbers)).sorted()
        continue
      }
      bullets.append(bullet(string))
    }
    return bullets
  }

  static func trailingCitations(_ text: String) -> (text: String, numbers: [Int]) {
    let allowed = Set("0123456789[](), ;")
    guard let open = text.firstIndex(where: { $0 == "[" || $0 == "(" }),
      text[open...].allSatisfy({ allowed.contains($0) }), text[open...].contains(where: \.isNumber)
    else {
      return (text, [])
    }
    let numbers = text[open...].split { !$0.isNumber }.compactMap { Int($0) }
    let body = text[..<open].trimmingCharacters(in: .whitespaces)
    return (body, numbers)
  }

  private static func isBullet(_ line: String) -> Bool {
    if line.hasPrefix("- ") || line.hasPrefix("\u{2022} ") || line.hasPrefix("* ") { return true }
    let digits = line.prefix { $0.isNumber }
    return !digits.isEmpty && line.dropFirst(digits.count).hasPrefix(". ")
  }

  private static func stripMarker(_ line: String) -> String {
    var rest = Substring(line)
    for marker in ["- ", "\u{2022} ", "* ", "? "] where rest.hasPrefix(marker) {
      rest = rest.dropFirst(marker.count)
      break
    }
    let digits = rest.prefix { $0.isNumber }
    if !digits.isEmpty, rest.dropFirst(digits.count).hasPrefix(". ") {
      rest = rest.dropFirst(digits.count + 2)
    }
    return rest.trimmingCharacters(in: .whitespaces)
  }

  private static func value(of key: String, in line: String) -> String? {
    let lowered = line.lowercased()
    guard lowered.hasPrefix(key) else { return nil }
    let rest = line.dropFirst(key.count).drop { $0 == " " }
    guard rest.first == ":" else { return nil }
    return rest.dropFirst().trimmingCharacters(in: .whitespaces)
  }

  private static func clean(_ text: String) -> String {
    text.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "<", with: "")
      .replacingOccurrences(of: ">", with: "").trimmingCharacters(in: .whitespaces)
  }
}

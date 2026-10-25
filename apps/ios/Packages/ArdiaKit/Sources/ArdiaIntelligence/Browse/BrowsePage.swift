import Foundation

public struct BrowseSource: Sendable, Codable, Hashable, Identifiable {
  public var number: Int
  public var url: URL
  public var title: String
  public var siteName: String
  public var snippet: String
  public var faviconURL: URL?
  public var imageURL: URL?

  public var id: Int { number }

  public init(
    number: Int, url: URL, title: String, siteName: String, snippet: String, faviconURL: URL? = nil,
    imageURL: URL? = nil
  ) {
    self.number = number
    self.url = url
    self.title = title
    self.siteName = siteName
    self.snippet = snippet
    self.faviconURL = faviconURL
    self.imageURL = imageURL
  }
}

public struct BrowseBullet: Sendable, Codable, Hashable, Identifiable {
  public var id: Int
  public var emoji: String
  public var lead: String
  public var text: String
  public var citations: [Int]

  public init(id: Int, emoji: String = "", lead: String = "", text: String, citations: [Int]) {
    self.id = id
    self.emoji = emoji
    self.lead = lead
    self.text = text
    self.citations = citations
  }
}

public struct BrowseSection: Sendable, Codable, Hashable, Identifiable {
  public var id: Int
  public var heading: String
  public var bullets: [BrowseBullet]

  public init(id: Int, heading: String, bullets: [BrowseBullet]) {
    self.id = id
    self.heading = heading
    self.bullets = bullets
  }
}

public struct BrowsePage: Sendable, Codable, Hashable {
  public static let schemaVersion = 1
  static let maximumLeadWords = 5
  static let maximumSections = 6

  public enum DecodingFailure: Error, Equatable {
    case newerVersion(Int)
  }

  public var version: Int
  public var query: String
  public var created: Date
  public var title: String
  public var answer: String
  public var sections: [BrowseSection]
  public var followUps: [String]
  public var sources: [BrowseSource]
  public var heroImages: [URL]
  public var language: String?

  public var heroImageURL: URL? { heroImages.first }

  public init(
    query: String, created: Date = .now, title: String = "", answer: String = "", sections: [BrowseSection] = [],
    followUps: [String] = [], sources: [BrowseSource] = [], heroImages: [URL] = [], language: String? = nil
  ) {
    self.version = Self.schemaVersion
    self.query = query
    self.created = created
    self.title = title
    self.answer = answer
    self.sections = sections
    self.followUps = followUps
    self.sources = sources
    self.heroImages = heroImages
    self.language = language
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(Int.self, forKey: .version)
    guard version <= Self.schemaVersion else { throw DecodingFailure.newerVersion(version) }
    self.version = version
    query = try container.decode(String.self, forKey: .query)
    created = try container.decode(Date.self, forKey: .created)
    title = try container.decode(String.self, forKey: .title)
    answer = try container.decode(String.self, forKey: .answer)
    sections = try container.decode([BrowseSection].self, forKey: .sections)
    followUps = try container.decodeIfPresent([String].self, forKey: .followUps) ?? []
    sources = try container.decode([BrowseSource].self, forKey: .sources)
    heroImages = try container.decodeIfPresent([URL].self, forKey: .heroImages) ?? []
    language = try container.decodeIfPresent(String.self, forKey: .language)
  }

  public func payload() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(self)
  }

  public init(payload: Data) throws {
    self = try JSONDecoder().decode(BrowsePage.self, from: payload)
  }

  public func source(numbered number: Int) -> BrowseSource? {
    sources.first { $0.number == number }
  }

  public var isEmpty: Bool {
    title.isEmpty && answer.isEmpty && sections.isEmpty
  }

  mutating func apply(_ draft: BrowsePageDraft, finished: Bool) {
    let validNumbers = Set(sources.map(\.number))
    title = clean(draft.title ?? "")
    answer = Citations.strip(draft.answer ?? "").text
    var built: [BrowseSection] = []
    for (sectionIndex, section) in draft.sections.prefix(Self.maximumSections).enumerated() {
      var bullets: [BrowseBullet] = []
      for (bulletIndex, bullet) in section.bullets.prefix(5).enumerated() {
        let stripped = Citations.strip(bullet.text ?? "")
        guard !stripped.text.isEmpty else { continue }
        let numbers = Array(Set(bullet.sources + stripped.numbers).intersection(validNumbers)).sorted()
        let candidate = clean(bullet.lead ?? "").trimmingCharacters(in: CharacterSet(charactersIn: ":"))
        let lead = candidate.split(whereSeparator: \.isWhitespace).count > Self.maximumLeadWords ? "" : candidate
        bullets.append(
          BrowseBullet(
            id: bulletIndex, emoji: Emoji.single(bullet.emoji ?? ""), lead: lead,
            text: Self.dropLead(lead, from: stripped.text), citations: numbers))
      }
      let heading = clean(section.heading ?? "")
      if finished, bullets.isEmpty { continue }
      if heading.isEmpty, bullets.isEmpty { continue }
      built.append(BrowseSection(id: sectionIndex, heading: heading, bullets: bullets))
    }
    sections = built
    var questions: [String] = []
    for question in draft.followUps.map(clean) where !question.isEmpty && !questions.contains(question) {
      questions.append(question)
    }
    followUps = Array(questions.prefix(3))
  }

  static func dropLead(_ lead: String, from text: String) -> String {
    guard !lead.isEmpty, text.lowercased().hasPrefix(lead.lowercased()) else { return text }
    let rest = text.dropFirst(lead.count).drop { ":-\u{2013}\u{2014} ".contains($0) }
    guard let first = rest.first else { return text }
    return first.uppercased() + rest.dropFirst()
  }

  private func clean(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

enum Emoji {
  static func single(_ text: String) -> String {
    guard let first = text.trimmingCharacters(in: .whitespacesAndNewlines).first,
      let scalar = first.unicodeScalars.first, scalar.properties.isEmoji,
      scalar.properties.isEmojiPresentation || first.unicodeScalars.count > 1
    else { return "" }
    return String(first)
  }
}

enum Citations {
  static func strip(_ text: String) -> (text: String, numbers: [Int]) {
    var numbers: [Int] = []
    let pattern = /\s*\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/
    let cleaned = text.replacing(pattern) { match in
      numbers += match.output.1.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
      return ""
    }
    return (cleaned.trimmingCharacters(in: .whitespacesAndNewlines), numbers)
  }
}

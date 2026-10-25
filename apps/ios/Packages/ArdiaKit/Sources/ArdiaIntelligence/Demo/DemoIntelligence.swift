import Foundation

public final class DemoIntelligenceModel: IntelligenceModel {
  public let status: IntelligenceStatus
  public let contextSize = 8_192
  private let pace: Duration

  public init(status: IntelligenceStatus = .available, pace: Duration = .milliseconds(45)) {
    self.status = status
    self.pace = pace
  }

  public func supportsLanguage(_ code: String) -> Bool { true }
  public func tokenCount(of text: String) async -> Int? { nil }
  public func schemaTokens(for kind: GenerationKind) async -> Int? { nil }
  public func prewarm(instructions: String, promptPrefix: String?) {}
  public func statusChanges() -> AsyncStream<IntelligenceStatus> { AsyncStream { $0.finish() } }

  public func condense(instructions: String, prompt: String) async throws -> String {
    try await Task.sleep(for: pace * 10)
    return "The page covers the main points in order."
  }

  public func streamOverview(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    let page = DemoContent.page(for: "").draft
    let overview = DemoContent.Page(draft: BrowsePageDraft(title: page.title, answer: page.answer))
    return Self.typewriter(pace: pace, first: .milliseconds(500), total: overview.wordCount) { words in
      overview.prefix(words: words)
    }
  }

  public func streamSections(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    let page = DemoContent.page(for: "").draft
    let sections = DemoContent.Page(draft: BrowsePageDraft(sections: page.sections, followUps: page.followUps))
    return Self.typewriter(pace: pace, first: .milliseconds(700), total: sections.wordCount) { words in
      sections.prefix(words: words)
    }
  }

  public func streamSummary(instructions: String, prompt: String) -> AsyncThrowingStream<PageSummary, any Error> {
    let summary = DemoContent.summary(fromPrompt: prompt)
    let words = ([summary.headline] + summary.points.map(\.text)).joined(separator: " ").split(separator: " ").count
    return Self.typewriter(pace: pace, first: .milliseconds(1_200), total: words) { count in
      DemoContent.prefix(summary, words: count)
    }
  }

  public func makeConversation(instructions: String) -> any IntelligenceConversation {
    DemoConversation(pace: pace)
  }

  static func typewriter<Element: Sendable>(
    pace: Duration, first: Duration, total: Int, _ make: @escaping @Sendable (Int) -> Element
  ) -> AsyncThrowingStream<Element, any Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          try await Task.sleep(for: first)
          var count = 0
          while count < total {
            count = min(total, count + 3)
            continuation.yield(make(count))
            try await Task.sleep(for: pace)
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}

final class DemoConversation: IntelligenceConversation {
  private let pace: Duration

  init(pace: Duration) {
    self.pace = pace
  }

  func streamAnswer(to prompt: String) -> AsyncThrowingStream<String, any Error> {
    let words = "The page says the park is busiest from February to May, so arrive before 8 AM to find parking near the trailheads."
      .split(separator: " ")
    return DemoIntelligenceModel.typewriter(pace: pace, first: .milliseconds(400), total: words.count) {
      words.prefix($0).joined(separator: " ")
    }
  }
}

public struct DemoSourcing: BrowseSourcing {
  public enum Outcome: Sendable {
    case works
    case offline
    case noResults
  }

  private let outcome: Outcome

  public init(_ outcome: Outcome = .works) {
    self.outcome = outcome
  }

  public func search(_ query: String) async throws -> [SearchResult] {
    try await Task.sleep(for: .milliseconds(650))
    switch outcome {
    case .works: return DemoContent.results
    case .offline: throw SourceError.offline
    case .noResults: return []
    }
  }

  public func read(_ result: SearchResult) async throws -> ReadablePage {
    let index = DemoContent.results.firstIndex(of: result) ?? 0
    try await Task.sleep(for: .milliseconds(350 + index * 260))
    if index == 4 { throw SourceError.timedOut }
    let artwork: [Int: DemoArtwork.Scene] = [0: .sunset, 1: .night, 2: .boulders]
    return ReadablePage(
      url: result.url, title: result.title, siteName: DemoContent.siteNames[index],
      imageURL: artwork[index].flatMap(DemoArtwork.url(for:)), blocks: [
        TextBlock(kind: .paragraph, text: result.snippet + " " + result.snippet)
      ])
  }
}

enum DemoContent {
  static let results: [SearchResult] = [
    ("https://www.nps.gov/jotr/planyourvisit/things2do.htm", "Things To Do - Joshua Tree National Park", "Hike, climb, stargaze and explore the desert where the Mojave and Colorado meet."),
    ("https://en.wikipedia.org/wiki/Joshua_Tree_National_Park", "Joshua Tree National Park - Wikipedia", "Joshua Tree National Park is an American national park in southeastern California."),
    ("https://www.visitcalifornia.com/places-to-visit/joshua-tree-national-park/", "Joshua Tree National Park | Visit California", "Plan a trip to see surreal rock formations, spiky trees and dark night skies."),
    ("https://www.cntraveler.com/story/best-things-to-do-in-joshua-tree", "The Best Things to Do in Joshua Tree", "From Skull Rock to Keys View, the stops worth your time on a first visit."),
    ("https://www.outsideonline.com/adventure-travel/joshua-tree-guide", "The Ultimate Joshua Tree Guide", "Where to hike, camp and climb, and when to go."),
    ("https://www.lonelyplanet.com/usa/california/joshua-tree-national-park", "Joshua Tree National Park travel", "Lonely Planet's guide to the park, its towns and its trails."),
  ].map { SearchResult(url: URL(string: $0.0)!, title: $0.1, snippet: $0.2) }

  static let siteNames = ["National Park Service", "Wikipedia", "Visit California", "Cond\u{00E9} Nast Traveler", "Outside", "Lonely Planet"]

  struct Page {
    var draft: BrowsePageDraft

    var wordCount: Int {
      words(in: draft.title) + words(in: draft.answer)
        + draft.sections.reduce(0) { total, section in
          total + words(in: section.heading) + section.bullets.reduce(0) { $0 + words(in: $1.lead) + words(in: $1.text) + 1 }
        } + draft.followUps.reduce(0) { $0 + words(in: $1) }
    }

    func prefix(words limit: Int) -> BrowsePageDraft {
      var budget = limit
      func take(_ text: String?) -> String? {
        guard let text, budget > 0 else { return nil }
        let parts = text.split(separator: " ")
        let taken = parts.prefix(budget)
        budget -= taken.count
        return taken.joined(separator: " ")
      }
      var result = BrowsePageDraft(title: take(draft.title), answer: take(draft.answer))
      for section in draft.sections where budget > 0 {
        var built = BrowsePageDraft.Section(heading: take(section.heading))
        for bullet in section.bullets where budget > 0 {
          budget -= 1
          built.bullets.append(.init(emoji: bullet.emoji, lead: take(bullet.lead), text: take(bullet.text), sources: bullet.sources))
        }
        result.sections.append(built)
      }
      for question in draft.followUps where budget > 0 {
        if let taken = take(question) { result.followUps.append(taken) }
      }
      return result
    }

    private func words(in text: String?) -> Int {
      text?.split(separator: " ").count ?? 0
    }
  }

  static func page(for question: String) -> Page {
    Page(
      draft: BrowsePageDraft(
        title: "A First Visit to Joshua Tree",
        answer: "Joshua Tree rewards an early start: hike a short trail at sunrise, climb on the boulders around Hidden Valley, drive up to Keys View for the sunset, and stay for some of the darkest skies in Southern California.",
        sections: [
          .init(heading: "Short Hikes", bullets: [
            .init(emoji: "\u{1F97E}", lead: "Hidden Valley", text: "A one mile loop through boulders, once used to hide cattle.", sources: [1, 4]),
            .init(emoji: "\u{1F335}", lead: "Cholla Cactus Garden", text: "A quarter mile path through dense teddy bear cholla, best at golden hour.", sources: [1, 3]),
            .init(emoji: "\u{1FAA8}", lead: "Skull Rock", text: "A roadside rock shaped like a skull, with an easy trail behind it.", sources: [4]),
          ]),
          .init(heading: "Views and Night Skies", bullets: [
            .init(emoji: "\u{1F304}", lead: "Keys View", text: "A paved overlook at 5,185 feet with views over the Coachella Valley.", sources: [2, 4]),
            .init(emoji: "\u{2728}", lead: "Stargazing", text: "The park is a certified International Dark Sky Park.", sources: [1, 2]),
          ]),
          .init(heading: "When to Go", bullets: [
            .init(emoji: "\u{1F321}\u{FE0F}", lead: "Spring and fall", text: "Days are mild from March to May and October to November.", sources: [3, 5]),
            .init(emoji: "\u{1F697}", lead: "Arrive early", text: "Parking at popular trailheads fills by mid morning on weekends.", sources: [1, 6]),
          ]),
        ],
        followUps: ["Where should I camp in Joshua Tree?", "Is Joshua Tree good for kids?", "What should I pack for the desert?"]))
  }

  static let summary = PageSummary(
    headline: "Joshua Tree is two deserts in one park, best explored on short hikes early in the day.",
    points: [
      SummaryPoint(symbol: "figure.hiking", label: "Hikes", text: "Hidden Valley and Barker Dam are short loops that suit a first visit."),
      SummaryPoint(symbol: "sun.max", label: "Weather", text: "Spring and fall are mild; summer afternoons often pass 100\u{00B0}F."),
      SummaryPoint(symbol: "sparkles", label: "Night Skies", text: "It is an International Dark Sky Park, so stay after sunset."),
    ])

  static func summary(fromPrompt prompt: String) -> PageSummary {
    let body = prompt.components(separatedBy: "\n\n").dropFirst(2).joined(separator: "\n")
    var sentences: [String] = []
    for line in body.split(whereSeparator: \.isNewline) {
      for piece in line.components(separatedBy: ". ") {
        let sentence = piece.trimmingCharacters(in: .whitespaces)
        if sentence.split(separator: " ").count >= 6 { sentences.append(sentence) }
      }
    }
    guard sentences.count >= 2 else { return summary }
    let points = zip(sentences.dropFirst().prefix(3), [("book", "Overview"), ("mappin.and.ellipse", "Details"), ("lightbulb", "Good to Know")])
      .map { sentence, style in
        SummaryPoint(symbol: style.0, label: style.1, text: sentence.hasSuffix(".") ? sentence : sentence + ".")
      }
    let headline = sentences[0].hasSuffix(".") ? sentences[0] : sentences[0] + "."
    return PageSummary(headline: headline, points: points)
  }

  static func prefix(_ summary: PageSummary, words limit: Int) -> PageSummary {
    var budget = limit
    func take(_ text: String) -> String {
      let parts = text.split(separator: " ")
      let taken = parts.prefix(max(0, budget))
      budget -= taken.count
      return taken.joined(separator: " ")
    }
    let headline = take(summary.headline)
    var points: [SummaryPoint] = []
    for point in summary.points where budget > 0 {
      points.append(SummaryPoint(symbol: point.symbol, label: point.label, text: take(point.text)))
    }
    return PageSummary(headline: headline, points: points)
  }
}

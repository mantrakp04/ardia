import Foundation

public final class DemoIntelligenceModel: IntelligenceModel {
  public let status: IntelligenceStatus
  public let contextSize = 8_192
  private let pace: Duration
  private let failsWriting: Bool

  public init(status: IntelligenceStatus = .available, pace: Duration = .milliseconds(45), failsWriting: Bool = false) {
    self.status = status
    self.pace = pace
    self.failsWriting = failsWriting
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
    if failsWriting { return AsyncThrowingStream { $0.finish(throwing: IntelligenceError.failed) } }
    let page = DemoContent.page(for: prompt).draft
    let overview = DemoContent.Page(draft: BrowsePageDraft(title: page.title, answer: page.answer))
    return Self.typewriter(pace: pace, first: .milliseconds(500), total: overview.wordCount) { words in
      overview.prefix(words: words)
    }
  }

  public func streamSections(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    if failsWriting { return AsyncThrowingStream { $0.finish(throwing: IntelligenceError.failed) } }
    let page = DemoContent.page(for: prompt).draft
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
  private let slowdown: Int

  public init(_ outcome: Outcome = .works, slowdown: Int = 1) {
    self.outcome = outcome
    self.slowdown = max(1, slowdown)
  }

  public func search(_ query: String) async throws -> [SearchResult] {
    try await Task.sleep(for: .milliseconds(650 * slowdown))
    switch outcome {
    case .works: return DemoTopic.matching(query).results
    case .offline: throw SourceError.offline
    case .noResults: return []
    }
  }

  public func read(_ result: SearchResult) async throws -> ReadablePage {
    let topic = DemoTopic.containing(result)
    let index = topic.results.firstIndex(of: result) ?? 0
    try await Task.sleep(for: .milliseconds((350 + index * 260) * slowdown))
    if index == 4 { throw SourceError.timedOut }
    return ReadablePage(
      url: result.url, title: result.title, siteName: topic.siteNames[index],
      imageURL: topic.artwork[index].flatMap(DemoArtwork.url(for:)),
      blocks: topic.passages(for: index).map { TextBlock(kind: .paragraph, text: $0) })
  }
}

enum DemoContent {
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

  static func page(for prompt: String) -> Page {
    Page(draft: DemoTopic.matching(prompt).draft)
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
      .replacing(/\s*\[[^\]]*\]/, with: "")
      .replacing(/\s*\([^\)]*\)/, with: "")
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

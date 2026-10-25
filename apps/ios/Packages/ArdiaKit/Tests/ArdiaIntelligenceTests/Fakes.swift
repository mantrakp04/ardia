import Foundation
import Synchronization

@testable import ArdiaIntelligence

final class FakeModel: IntelligenceModel {
  enum PageScript: Sendable {
    case drafts([BrowsePageDraft])
    case draftsThenHang([BrowsePageDraft])
    case fail(IntelligenceError)
  }

  struct Record: Sendable {
    var pagePrompts: [String] = []
    var overviewPrompts: [String] = []
    var prewarmed: [String] = []
    var condensePrompts: [String] = []
    var summaryPrompts: [String] = []
    var conversationInstructions: [String] = []
    var questions: [String] = []
    var cancelledStreams = 0
  }

  let status: IntelligenceStatus
  let contextSize: Int
  private let scripts: Mutex<[PageScript]>
  private let overviews: Mutex<[PageScript]>
  private let summaries: [PageSummary]
  private let answers: [String]
  let record = Mutex(Record())

  init(
    status: IntelligenceStatus = .available, contextSize: Int = 8_192,
    overviews: [PageScript] = [.drafts(Sample.overview)], pages: [PageScript] = [],
    summaries: [PageSummary] = [], answers: [String] = []
  ) {
    self.status = status
    self.contextSize = contextSize
    scripts = Mutex(pages)
    self.overviews = Mutex(overviews)
    self.summaries = summaries
    self.answers = answers
  }

  var recorded: Record { record.withLock { $0 } }

  func supportsLanguage(_ code: String) -> Bool { code != "xx" }
  func tokenCount(of text: String) async -> Int? { nil }
  func schemaTokens(for kind: GenerationKind) async -> Int? { nil }
  func prewarm(instructions: String, promptPrefix: String?) {
    record.withLock { $0.prewarmed.append(instructions) }
  }
  func statusChanges() -> AsyncStream<IntelligenceStatus> { AsyncStream { $0.finish() } }

  func condense(instructions: String, prompt: String) async throws -> String {
    let count = record.withLock {
      $0.condensePrompts.append(prompt)
      return $0.condensePrompts.count
    }
    return "- Note \(count) from part \(count).\n- Another fact from part \(count)."
  }

  func streamOverview(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    record.withLock { $0.overviewPrompts.append(prompt) }
    return play(overviews.withLock { $0.isEmpty ? .drafts([]) : $0.removeFirst() })
  }

  func streamSections(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    record.withLock { $0.pagePrompts.append(prompt) }
    return play(scripts.withLock { $0.isEmpty ? .drafts([]) : $0.removeFirst() })
  }

  private func play(_ script: PageScript) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    stream { continuation in
      switch script {
      case .drafts(let drafts):
        for draft in drafts {
          try await Task.sleep(for: .milliseconds(2))
          continuation.yield(draft)
        }
      case .draftsThenHang(let drafts):
        for draft in drafts { continuation.yield(draft) }
        try await Task.sleep(for: .seconds(60))
      case .fail(let error):
        throw error
      }
    }
  }

  func streamSummary(instructions: String, prompt: String) -> AsyncThrowingStream<PageSummary, any Error> {
    record.withLock { $0.summaryPrompts.append(prompt) }
    let summaries = summaries
    return stream { continuation in
      for summary in summaries { continuation.yield(summary) }
    }
  }

  func makeConversation(instructions: String) -> any IntelligenceConversation {
    record.withLock { $0.conversationInstructions.append(instructions) }
    return FakeConversation(model: self)
  }

  func answer(_ prompt: String) -> AsyncThrowingStream<String, any Error> {
    let index = record.withLock {
      $0.questions.append(prompt)
      return $0.questions.count - 1
    }
    let full = index < answers.count ? answers[index] : "The page doesn't cover that."
    return stream { continuation in
      let words = full.split(separator: " ")
      for end in 1...words.count { continuation.yield(words.prefix(end).joined(separator: " ")) }
    }
  }

  private func stream<Element: Sendable>(
    _ body: @escaping @Sendable (AsyncThrowingStream<Element, any Error>.Continuation) async throws -> Void
  ) -> AsyncThrowingStream<Element, any Error> {
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          try await body(continuation)
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { termination in
        if case .cancelled = termination { self.record.withLock { $0.cancelledStreams += 1 } }
        task.cancel()
      }
    }
  }
}

final class FakeConversation: IntelligenceConversation {
  private let model: FakeModel

  init(model: FakeModel) {
    self.model = model
  }

  func streamAnswer(to prompt: String) -> AsyncThrowingStream<String, any Error> {
    model.answer(prompt)
  }
}

final class SourcingLog: Sendable {
  private let events = Mutex<[String]>([])

  func append(_ event: String) {
    events.withLock { $0.append(event) }
  }

  var all: [String] { events.withLock { $0 } }
  func count(_ prefix: String) -> Int { all.filter { $0.hasPrefix(prefix) }.count }
}

struct FakeSourcing: BrowseSourcing {
  enum Read: Sendable {
    case page(ReadablePage)
    case fail
    case hang
  }

  var search: Result<[SearchResult], SourceError>
  var reads: [URL: Read]
  let log = SourcingLog()

  func search(_ query: String) async throws -> [SearchResult] {
    log.append("search \(query)")
    try await Task.sleep(for: .milliseconds(1))
    return try search.get()
  }

  func read(_ result: SearchResult) async throws -> ReadablePage {
    log.append("read \(result.url.absoluteString)")
    switch reads[result.url] ?? .fail {
    case .page(let page):
      try await Task.sleep(for: .milliseconds(3))
      return page
    case .fail:
      throw SourceError.failed
    case .hang:
      do {
        try await Task.sleep(for: .seconds(60))
      } catch {
        log.append("cancelled \(result.url.absoluteString)")
        throw error
      }
      throw SourceError.timedOut
    }
  }
}

enum Sample {
  static func result(_ number: Int) -> SearchResult {
    SearchResult(
      url: URL(string: "https://site\(number).example/article")!, title: "Result \(number)",
      snippet: "Snippet for result \(number).")
  }

  static func page(_ number: Int, image: Bool = true) -> ReadablePage {
    ReadablePage(
      url: result(number).url, title: "Article \(number)", siteName: "Site \(number)",
      imageURL: image ? URL(string: "https://site\(number).example/hero.jpg") : nil,
      blocks: [
        TextBlock(kind: .heading, text: "About source \(number)"),
        TextBlock(
          kind: .paragraph,
          text: "Source \(number) says carbon plated running shoes save about \(number) percent of energy at race pace, according to lab tests on twenty runners."),
        TextBlock(
          kind: .paragraph,
          text: "It also notes that cushioned trainers suit easy days and that most runners rotate two pairs to make each one last longer."),
      ])
  }

  static func sourcing(_ count: Int, overrides: [Int: FakeSourcing.Read] = [:]) -> FakeSourcing {
    let results = (1...count).map(result)
    var reads: [URL: FakeSourcing.Read] = [:]
    for number in 1...count { reads[result(number).url] = overrides[number] ?? .page(page(number)) }
    return FakeSourcing(search: .success(results), reads: reads)
  }

  static let overview: [BrowsePageDraft] = [
    BrowsePageDraft(title: "Carbon"),
    BrowsePageDraft(title: "Carbon Plate Shoes", answer: "They save energy"),
    BrowsePageDraft(title: "Carbon Plate Shoes", answer: "They save energy at race pace [1]."),
  ]

  static let drafts: [BrowsePageDraft] = [
    BrowsePageDraft(
      sections: [.init(heading: "Energy", bullets: [.init(emoji: "\u{26A1}", lead: "Savings", text: "Lab tests show savings [2]", sources: [1, 9])])]),
    BrowsePageDraft(
      sections: [
        .init(heading: "Energy", bullets: [.init(emoji: "\u{26A1}", lead: "Savings", text: "Lab tests show savings [2]", sources: [1, 9])]),
        .init(heading: "Everyday use", bullets: [
          .init(emoji: "no", lead: "Rotation:", text: "Rotation: rotate two pairs.", sources: [3]),
          .init(lead: "How most runners split their shoes", text: "Most runners own a race pair and a daily pair.", sources: [2]),
        ]),
        .init(heading: "", bullets: []),
      ],
      followUps: ["Are they worth it?", "Are they worth it?", "Do they cause injuries?", "Which brands lead?", "Extra?"]),
  ]
}

@MainActor
func eventually(timeout: Duration = .seconds(3), _ condition: () -> Bool) async -> Bool {
  let deadline = ContinuousClock.now + timeout
  while !condition() {
    if ContinuousClock.now > deadline { return false }
    try? await Task.sleep(for: .milliseconds(5))
  }
  return true
}

import Foundation
import FoundationModels
import Synchronization

@Generable(description: "The top of an answer page: its title and a direct answer")
struct GeneratedOverview {
  @Guide(description: "A short, specific title for the page in title case, at most 8 words")
  var title: String

  @Guide(description: "A direct answer to the question in 1 or 2 short sentences, under 40 words, using only the search results")
  var answer: String
}

@Generable(description: "The body of an answer page built only from numbered web sources")
struct GeneratedSections {
  @Guide(description: "Usually 3 sections that cover the question from different angles", .count(1...3))
  var sections: [GeneratedSection]

  @Guide(description: "Questions the reader might ask next, each under 8 words", .count(3))
  var followUps: [String]
}

@Generable(description: "A section of the answer page")
struct GeneratedSection {
  @Guide(description: "A short heading of 2 to 5 words")
  var heading: String

  @Guide(description: "The points in this section, usually 2", .count(1...3))
  var bullets: [GeneratedBullet]
}

@Generable(description: "One point, with the sources it comes from")
struct GeneratedBullet {
  @Guide(description: "One emoji that fits the point")
  var emoji: String

  @Guide(description: "A bold lead of 1 to 3 words that names the point, like Price or Best For")
  var lead: String

  @Guide(description: "The point in one short sentence under 18 words, without source numbers")
  var text: String

  @Guide(description: "The numbers of the sources this point comes from", .count(1...3))
  var sources: [Int]
}

@Generable(description: "A summary of a web page")
struct GeneratedSummary {
  @Guide(description: "A headline with the page's main point, in one sentence")
  var headline: String

  @Guide(description: "The key details, each with an icon, a label and a sentence", .count(1...5))
  var details: [GeneratedDetail]
}

@Generable(description: "One detail of the summary")
struct GeneratedDetail {
  @Guide(description: "The SF Symbol that best fits this detail", .anyOf(SummaryPoint.symbols))
  var icon: String

  @Guide(description: "A label of 1 to 4 words for this detail")
  var label: String

  @Guide(description: "The detail in one or two short sentences")
  var text: String
}

public final class FoundationIntelligenceModel: IntelligenceModel {
  private let model: SystemLanguageModel
  private let warmSessions = Mutex<[String: LanguageModelSession]>([:])

  public init(model: SystemLanguageModel = .default) {
    self.model = model
  }

  public var status: IntelligenceStatus {
    switch model.availability {
    case .available:
      model.supportsLocale(Locale.current) ? .available : .languageUnsupported
    case .unavailable(.deviceNotEligible): .deviceNotEligible
    case .unavailable(.appleIntelligenceNotEnabled): .appleIntelligenceOff
    case .unavailable(.modelNotReady): .modelDownloading
    case .unavailable: .deviceNotEligible
    }
  }

  public var contextSize: Int { model.contextSize }

  public func supportsLanguage(_ code: String) -> Bool {
    model.supportedLanguages.contains { $0.languageCode?.identifier == code }
  }

  public func tokenCount(of text: String) async -> Int? {
    try? await model.tokenCount(for: text)
  }

  public func schemaTokens(for kind: GenerationKind) async -> Int? {
    switch kind {
    case .overview: try? await model.tokenCount(for: GeneratedOverview.generationSchema)
    case .sections: try? await model.tokenCount(for: GeneratedSections.generationSchema)
    case .summary: try? await model.tokenCount(for: GeneratedSummary.generationSchema)
    case .notes, .answer: 0
    }
  }

  public func prewarm(instructions: String, promptPrefix: String?) {
    guard model.isAvailable else { return }
    let session = warmSessions.withLock { sessions in
      if let existing = sessions[instructions] { return existing }
      let created = LanguageModelSession(model: model, instructions: instructions)
      sessions[instructions] = created
      if sessions.count > 3, let stale = sessions.keys.first(where: { $0 != instructions }) {
        sessions.removeValue(forKey: stale)
      }
      return created
    }
    session.prewarm(promptPrefix: promptPrefix.map { Prompt($0) })
  }

  private func session(for instructions: String) -> LanguageModelSession {
    warmSessions.withLock { $0.removeValue(forKey: instructions) }
      ?? LanguageModelSession(model: model, instructions: instructions)
  }

  public func condense(instructions: String, prompt: String) async throws -> String {
    let session = session(for: instructions)
    do {
      let response = try await session.respond(
        to: prompt, options: GenerationOptions(temperature: 0.2, maximumResponseTokens: 360))
      return response.content
    } catch {
      throw Self.map(error)
    }
  }

  public func streamOverview(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    let session = session(for: instructions)
    return Self.relay { continuation in
      let stream = session.streamResponse(
        to: prompt, generating: GeneratedOverview.self,
        options: GenerationOptions(temperature: 0.3, maximumResponseTokens: 140))
      for try await snapshot in stream {
        continuation.yield(BrowsePageDraft(title: snapshot.content.title, answer: snapshot.content.answer))
      }
    }
  }

  public func streamSections(instructions: String, prompt: String) -> AsyncThrowingStream<BrowsePageDraft, any Error> {
    let session = session(for: instructions)
    return Self.relay { continuation in
      let stream = session.streamResponse(
        to: prompt, generating: GeneratedSections.self,
        options: GenerationOptions(temperature: 0.3, maximumResponseTokens: 600))
      for try await snapshot in stream {
        continuation.yield(BrowsePageDraft(snapshot.content))
      }
    }
  }

  public func streamSummary(instructions: String, prompt: String) -> AsyncThrowingStream<PageSummary, any Error> {
    let session = session(for: instructions)
    return Self.relay { continuation in
      let stream = session.streamResponse(
        to: prompt, generating: GeneratedSummary.self,
        options: GenerationOptions(temperature: 0.2, maximumResponseTokens: 500))
      for try await snapshot in stream {
        continuation.yield(
          PageSummary(
            headline: snapshot.content.headline ?? "",
            points: (snapshot.content.details ?? []).map {
              SummaryPoint(
                symbol: $0.icon.flatMap { SummaryPoint.symbols.contains($0) ? $0 : nil } ?? "", label: $0.label ?? "",
                text: $0.text ?? "")
            }))
      }
    }
  }

  public func makeConversation(instructions: String) -> any IntelligenceConversation {
    FoundationConversation(session: session(for: instructions))
  }

  public func statusChanges() -> AsyncStream<IntelligenceStatus> {
    let model = model
    return AsyncStream { continuation in
      let task = Task {
        for await _ in Observations({ model.availability }) {
          continuation.yield(self.status)
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  static func relay<Element: Sendable>(
    _ body: @escaping @Sendable (AsyncThrowingStream<Element, any Error>.Continuation) async throws -> Void
  ) -> AsyncThrowingStream<Element, any Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          try await body(continuation)
          continuation.finish()
        } catch {
          continuation.finish(throwing: map(error))
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  static func map(_ error: any Error) -> any Error {
    if error is CancellationError || Task.isCancelled { return CancellationError() }
    if let error = error as? IntelligenceError { return error }
    if let error = error as? LanguageModelError {
      switch error {
      case .contextSizeExceeded: return IntelligenceError.contextExceeded
      case .guardrailViolation: return IntelligenceError.guardrail
      case .refusal: return IntelligenceError.refusal
      case .unsupportedLanguageOrLocale: return IntelligenceError.unsupportedLanguage
      case .rateLimited: return IntelligenceError.rateLimited
      case .timeout: return IntelligenceError.timedOut
      default: return IntelligenceError.failed
      }
    }
    if error is SystemLanguageModel.Error { return IntelligenceError.unavailable(.modelDownloading) }
    return IntelligenceError.failed
  }
}

final class FoundationConversation: IntelligenceConversation {
  private let session: LanguageModelSession

  init(session: LanguageModelSession) {
    self.session = session
  }

  func streamAnswer(to prompt: String) -> AsyncThrowingStream<String, any Error> {
    let session = session
    return FoundationIntelligenceModel.relay { continuation in
      let stream = session.streamResponse(
        to: prompt, options: GenerationOptions(temperature: 0.3, maximumResponseTokens: 400))
      for try await snapshot in stream {
        continuation.yield(snapshot.content)
      }
    }
  }
}

extension BrowsePageDraft {
  init(_ partial: GeneratedSections.PartiallyGenerated) {
    self.init(
      sections: (partial.sections ?? []).map { section in
        Section(
          heading: section.heading,
          bullets: (section.bullets ?? []).map {
            Bullet(emoji: $0.emoji, lead: $0.lead, text: $0.text, sources: $0.sources ?? [])
          })
      },
      followUps: partial.followUps ?? [])
  }
}

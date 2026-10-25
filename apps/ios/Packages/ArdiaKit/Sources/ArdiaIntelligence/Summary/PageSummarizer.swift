import Foundation
import Observation

@MainActor
@Observable
public final class PageSummarizer {
  public enum Phase: Sendable, Hashable {
    case idle
    case reading(part: Int, of: Int)
    case writing
    case done
    case failed(SummaryFailure)
    case cancelled
  }

  public struct Exchange: Sendable, Hashable, Identifiable {
    public enum State: Sendable, Hashable {
      case waiting
      case answering
      case answered
      case stopped
      case failed(SummaryFailure)
    }

    public let id: UUID
    public let question: String
    public var answer: String
    public var state: State
  }

  public static let maximumChunks = 6

  public let page: PageText
  public private(set) var phase: Phase = .idle
  public private(set) var summary = PageSummary()
  public private(set) var exchanges: [Exchange] = []

  private let model: any IntelligenceModel
  private var summaryTask: Task<Void, Never>?
  private var askTask: Task<Void, Never>?
  private var runID = 0
  private var askEpoch = 0
  private var conversation: (any IntelligenceConversation)?
  private var sharedPassages: Set<String> = []

  public init(page: PageText, model: any IntelligenceModel) {
    self.page = page
    self.model = model
  }

  public var isSummarizing: Bool {
    switch phase {
    case .reading, .writing: true
    case .idle, .done, .failed, .cancelled: false
    }
  }

  public var isAnswering: Bool {
    exchanges.contains { $0.state == .answering || $0.state == .waiting }
  }

  public func prewarm() {
    guard model.status.isAvailable else { return }
    model.prewarm(instructions: Prompts.summaryInstructions)
  }

  public func summarize() {
    guard !isSummarizing else { return }
    summaryTask = Task { await runSummary() }
  }

  public func ask(question: String) {
    let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    let exchange = Exchange(id: UUID(), question: trimmed, answer: "", state: .waiting)
    exchanges.append(exchange)
    let previous = askTask
    let run = askEpoch
    askTask = Task {
      await previous?.value
      await self.answer(exchange.id, run: run)
    }
  }

  public func cancel() {
    runID += 1
    askEpoch += 1
    summaryTask?.cancel()
    askTask?.cancel()
    summaryTask = nil
    askTask = nil
    if isSummarizing { phase = .cancelled }
    for index in exchanges.indices where exchanges[index].state == .answering || exchanges[index].state == .waiting {
      exchanges[index].state = .stopped
    }
  }

  public func runSummary() async {
    runID += 1
    let run = runID
    summary = PageSummary()
    let status = model.status
    guard status.isAvailable else {
      phase = .failed(.modelUnavailable(status))
      return
    }
    let blocks = PassageSelector.split(page.blocks)
    guard page.wordCount >= 40 else {
      phase = .failed(.nothingToSummarize)
      return
    }
    let inferred = Prompts.languageName(for: page.title + " " + page.paragraphs.prefix(3).joined(separator: " "))
    let language = model.supportsLanguage(inferred.code) ? inferred.name : Prompts.languageName(for: "").name
    let context = model.contextSize
    let instructionTokens = await model.tokenCount(of: Prompts.summaryInstructions) ?? 80
    let schemaTokens = await model.schemaTokens(for: .summary) ?? 200
    var budget = context - instructionTokens - schemaTokens - 500 - context / 16 - 60
    var material = blocks

    if Self.tokens(of: material) > budget {
      let chunkBudget = context - (await model.tokenCount(of: Prompts.chunkNotesInstructions) ?? 60) - 420 - context / 16
      let chunks = Self.chunk(blocks, tokenLimit: chunkBudget).prefix(Self.maximumChunks)
      var notes: [TextBlock] = []
      for (offset, chunk) in chunks.enumerated() {
        guard isCurrent(run) else { return }
        phase = .reading(part: offset + 1, of: chunks.count)
        do {
          let text = try await model.condense(
            instructions: Prompts.chunkNotesInstructions, prompt: chunk.map(\.text).joined(separator: "\n"))
          notes += text.split(whereSeparator: \.isNewline).map {
            TextBlock(kind: .paragraph, text: $0.trimmingCharacters(in: CharacterSet(charactersIn: "-\u{2022}* ").union(.whitespaces)))
          }.filter { !$0.text.isEmpty }
        } catch {
          guard isCurrent(run) else { return }
          if let error = error as? IntelligenceError, error != .contextExceeded {
            phase = .failed(SummaryFailure(error))
            return
          }
        }
      }
      material = notes.isEmpty ? blocks : notes
    }

    for attempt in 0..<2 {
      guard isCurrent(run) else { return }
      let selected = PassageSelector.select(material, terms: QueryTerms(""), tokenLimit: budget)
      let prompt = Prompts.summaryPrompt(
        title: page.title, site: page.siteName, text: selected.map(\.text).joined(separator: "\n"), language: language)
      phase = .writing
      do {
        for try await partial in model.streamSummary(instructions: Prompts.summaryInstructions, prompt: prompt) {
          guard isCurrent(run) else { return }
          summary = partial
        }
        guard isCurrent(run) else { return }
        summary.points = summary.points.filter { !$0.text.isEmpty }.map(\.finished)
        phase = summary.isEmpty ? .failed(.failed) : .done
        return
      } catch IntelligenceError.contextExceeded where attempt == 0 {
        budget = budget * 6 / 10
      } catch let error as IntelligenceError {
        guard isCurrent(run) else { return }
        phase = .failed(SummaryFailure(error))
        return
      } catch {
        guard isCurrent(run) else { return }
        phase = .failed(.failed)
        return
      }
    }
    phase = .failed(.failed)
  }

  private func isCurrent(_ run: Int) -> Bool {
    run == runID && !Task.isCancelled
  }

  private func isCurrentAsk(_ epoch: Int) -> Bool {
    epoch == askEpoch && !Task.isCancelled
  }

  private func answer(_ id: UUID, run: Int) async {
    guard isCurrentAsk(run) else { return }
    let status = model.status
    guard status.isAvailable else {
      update(id) { $0.state = .failed(.modelUnavailable(status)) }
      return
    }
    guard let question = exchanges.first(where: { $0.id == id })?.question else { return }
    update(id) { $0.state = .answering }
    for attempt in 0..<2 {
      let prompt = await prepareConversation(for: question, fresh: attempt > 0)
      guard let conversation else { return }
      do {
        for try await text in conversation.streamAnswer(to: prompt) {
          guard isCurrentAsk(run) else { return }
          update(id) { $0.answer = text }
        }
        guard isCurrentAsk(run) else { return }
        update(id) { $0.state = .answered }
        return
      } catch IntelligenceError.contextExceeded where attempt == 0 {
        self.conversation = nil
        update(id) { $0.answer = "" }
      } catch let error as IntelligenceError {
        guard isCurrentAsk(run) else { return }
        update(id) { $0.state = .failed(SummaryFailure(error)) }
        return
      } catch {
        guard isCurrentAsk(run) else { return }
        update(id) { $0.state = .failed(.failed) }
        return
      }
    }
    update(id) { $0.state = .failed(.failed) }
  }

  private func prepareConversation(for question: String, fresh: Bool) async -> String {
    let blocks = PassageSelector.split(page.blocks)
    let terms = QueryTerms(question)
    let language = Prompts.languageName(for: question).name
    if fresh || conversation == nil {
      sharedPassages = []
      let budget = model.contextSize * 45 / 100
      var context = ""
      if !summary.isEmpty {
        context = ([summary.headline] + summary.points.map { "\($0.label): \($0.text)" }).joined(separator: "\n") + "\n\n"
      }
      let selected = PassageSelector.select(blocks, terms: terms, tokenLimit: budget - TokenEstimate.tokens(in: context))
      sharedPassages = Set(selected.map(\.text))
      context += selected.map(\.text).joined(separator: "\n")
      conversation = model.makeConversation(
        instructions: Prompts.conversationInstructions(
          title: page.title, site: page.siteName, context: context, language: language))
      return question
    }
    let unseen = blocks.filter { !sharedPassages.contains($0.text) }
    let extra = PassageSelector.select(unseen, terms: terms, tokenLimit: 500).filter { terms.relevance(of: $0.text) > 0 }
    sharedPassages.formUnion(extra.map(\.text))
    return Prompts.questionPrompt(question, passages: extra.map(\.text).joined(separator: "\n"))
  }

  private func update(_ id: UUID, _ change: (inout Exchange) -> Void) {
    guard let index = exchanges.firstIndex(where: { $0.id == id }) else { return }
    change(&exchanges[index])
  }

  static func tokens(of blocks: [TextBlock]) -> Int {
    blocks.reduce(0) { $0 + TokenEstimate.tokens(in: $1.text) + 1 }
  }

  static func chunk(_ blocks: [TextBlock], tokenLimit: Int) -> [[TextBlock]] {
    var chunks: [[TextBlock]] = []
    var current: [TextBlock] = []
    var used = 0
    for block in blocks {
      let cost = TokenEstimate.tokens(in: block.text) + 1
      if used + cost > tokenLimit, !current.isEmpty {
        chunks.append(current)
        current = []
        used = 0
      }
      current.append(block)
      used += cost
    }
    if !current.isEmpty { chunks.append(current) }
    return chunks
  }
}

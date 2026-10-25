import Foundation
import Observation

@MainActor
@Observable
public final class BrowseForMe: Identifiable {
  public struct Configuration: Sendable {
    public var sourceLimit = 6
    public var candidateLimit = 10
    public var readingDeadline: Duration = .seconds(9)
    public var enoughSources = 3
    public var readingGrace: Duration = .seconds(1)
    public var overviewResults = 8
    public var responseReserve = 700
    public var minimumTokensPerSource = 320
    public var sourceTokenLimit = 2_400
    public var firstDraftTimeout: Duration = .seconds(20)
    public var stallTimeout: Duration = .seconds(6)
    public var language: LanguagePreference = .inferFromQuery
    public var today: Date?

    public init() {}

    public static let standard = Configuration()
  }

  public enum LanguagePreference: Sendable, Hashable {
    case inferFromQuery
    case preferred
  }

  public enum Phase: Sendable, Hashable {
    case idle
    case searching
    case reading
    case writing
    case done
    case failed(BrowseFailure)
    case cancelled
  }

  public struct SourceProgress: Sendable, Hashable, Identifiable {
    public enum State: Sendable, Hashable {
      case queued
      case reading
      case condensing
      case read
      case failed
      case skipped
    }

    public var id: Int
    public var result: SearchResult
    public var state: State
    public var siteName: String
    public var imageURL: URL?

    public var faviconURL: URL? { result.faviconURL }
  }

  public struct Timing: Sendable, Hashable {
    public var search: Duration?
    public var title: Duration?
    public var answer: Duration?
    public var reading: Duration?
    public var sectionsStart: Duration?
    public var firstSection: Duration?
    public var total: Duration?
    public var attempts = 0
  }

  public let id = UUID()
  public let query: String
  public private(set) var phase: Phase = .idle
  public private(set) var results: [SearchResult] = []
  public private(set) var sources: [SourceProgress] = []
  public private(set) var page: BrowsePage
  public private(set) var timing = Timing()

  private let model: any IntelligenceModel
  private let sourcing: any BrowseSourcing
  private let configuration: Configuration
  private var task: Task<Void, Never>?
  private var runID = 0
  private var readPages: [Int: ReadablePage] = [:]
  private var condensedBlocks: [Int: [TextBlock]] = [:]
  private let clock = ContinuousClock()
  @ObservationIgnored private var lastStreamProgress = ContinuousClock.now
  @ObservationIgnored private var streamHasStarted = false
  @ObservationIgnored private var overviewDraft = BrowsePageDraft()
  @ObservationIgnored private var sectionsDraft = BrowsePageDraft()
  @ObservationIgnored private var started = ContinuousClock.now

  private enum StreamPart {
    case overview
    case sections
  }

  public init(
    query: String, model: any IntelligenceModel, sourcing: any BrowseSourcing = WebSourcing(),
    configuration: Configuration = .standard
  ) {
    self.query = query
    self.model = model
    self.sourcing = sourcing
    self.configuration = configuration
    page = BrowsePage(query: query)
  }

  public init(
    restoring page: BrowsePage, model: any IntelligenceModel, sourcing: any BrowseSourcing = WebSourcing(),
    configuration: Configuration = .standard
  ) {
    self.query = page.query
    self.model = model
    self.sourcing = sourcing
    self.configuration = configuration
    self.page = page
    phase = .done
    sources = page.sources.map { source in
      SourceProgress(
        id: source.number,
        result: SearchResult(url: source.url, title: source.title, snippet: source.snippet),
        state: .read, siteName: source.siteName, imageURL: source.imageURL)
    }
    results = sources.map(\.result)
  }

  public var isRunning: Bool {
    switch phase {
    case .searching, .reading, .writing: true
    case .idle, .done, .failed, .cancelled: false
    }
  }

  public var failure: BrowseFailure? {
    if case .failed(let failure) = phase { return failure }
    return nil
  }

  public static func prewarm(_ model: any IntelligenceModel) {
    guard model.status.isAvailable else { return }
    model.prewarm(instructions: Prompts.overviewInstructions())
  }

  public func start() {
    guard !isRunning else { return }
    task = Task { await self.run() }
  }

  public func retry() {
    task?.cancel()
    task = nil
    phase = .idle
    start()
  }

  public func cancel() {
    guard isRunning else { return }
    runID += 1
    task?.cancel()
    task = nil
    phase = .cancelled
    for index in sources.indices where [.queued, .reading, .condensing].contains(sources[index].state) {
      sources[index].state = .skipped
    }
  }

  public func run() async {
    runID += 1
    let run = runID
    started = clock.now
    results = []
    sources = []
    readPages = [:]
    condensedBlocks = [:]
    overviewDraft = BrowsePageDraft()
    sectionsDraft = BrowsePageDraft()
    timing = Timing()
    page = BrowsePage(query: query)
    phase = .searching
    let today = configuration.today ?? .now
    if model.status.isAvailable {
      model.prewarm(instructions: Prompts.overviewInstructions(today: today), promptPrefix: Prompts.questionPrefix(query))
    }

    let found: [SearchResult]
    do {
      found = try await sourcing.search(query)
    } catch {
      guard isCurrent(run) else { return }
      fail(Self.searchFailure(error))
      return
    }
    guard isCurrent(run) else { return }
    results = found
    timing.search = started.duration(to: clock.now)
    let candidates = DuckDuckGoResults.distinctSites(found, limit: configuration.candidateLimit)
    guard !candidates.isEmpty else {
      fail(.noResults)
      return
    }

    let status = model.status
    guard status.isAvailable else {
      sources = candidates.prefix(configuration.sourceLimit).enumerated().map { index, result in
        SourceProgress(id: index, result: result, state: .skipped, siteName: result.displayHost)
      }
      fail(.modelUnavailable(status))
      return
    }

    phase = .reading
    let language = pageLanguage()
    page.language = language.code
    let grace = configuration.readingGrace
    let enough = configuration.enoughSources
    await withTaskGroup(of: Void.self) { group in
      group.addTask { await self.read(candidates, run: run) }
      await writeOverview(found, language: language, today: today, run: run)
      guard isCurrent(run), failure == nil else {
        group.cancelAll()
        return
      }
      model.prewarm(instructions: Prompts.sectionsInstructions(today: today), promptPrefix: Prompts.questionPrefix(query))
      if readPages.count >= enough {
        group.addTask { try? await Task.sleep(for: grace) }
        _ = await group.next()
        group.cancelAll()
      }
    }
    guard isCurrent(run), failure == nil else { return }
    for index in sources.indices where [.queued, .reading].contains(sources[index].state) {
      sources[index].state = .skipped
    }
    timing.reading = started.duration(to: clock.now)
    let readIDs = sources.filter { $0.state == .read }.map(\.id)
    guard !readIDs.isEmpty else {
      finishWithoutPages(found)
      return
    }
    await writeSections(readIDs, language: language, today: today, run: run)
  }

  private func writeOverview(
    _ found: [SearchResult], language: (code: String, name: String), today: Date, run: Int
  ) async {
    let entries = found.prefix(configuration.overviewResults).enumerated().map { offset, result in
      (number: offset + 1, title: result.title, site: result.displayHost, snippet: result.snippet)
    }
    let prompt = Prompts.overviewPrompt(question: query, language: language.name, results: entries)
    do {
      let draft = try await consume(
        model.streamOverview(instructions: Prompts.overviewInstructions(today: today), prompt: prompt), part: .overview,
        run: run)
      guard isCurrent(run) else { return }
      overviewDraft = draft
    } catch let error as IntelligenceError {
      guard isCurrent(run) else { return }
      switch error {
      case .guardrail, .refusal, .unsupportedLanguage, .unavailable:
        fail(BrowseFailure(error))
        return
      case .contextExceeded, .rateLimited, .timedOut, .failed:
        break
      }
    } catch {
      guard isCurrent(run) else { return }
    }
    if (overviewDraft.title ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
      overviewDraft.title = query.localizedCapitalized
    }
    applyDrafts(finished: false)
    timing.answer = started.duration(to: clock.now)
  }

  private func finishWithoutPages(_ found: [SearchResult]) {
    guard !(overviewDraft.answer ?? "").isEmpty else {
      fail(.sourcesUnreachable)
      return
    }
    page.sources = found.prefix(configuration.sourceLimit).enumerated().map { offset, result in
      BrowseSource(
        number: offset + 1, url: result.url, title: result.title, siteName: result.displayHost, snippet: result.snippet,
        faviconURL: result.faviconURL)
    }
    applyDrafts(finished: true)
    timing.total = started.duration(to: clock.now)
    phase = .done
  }

  private func applyDrafts(finished: Bool) {
    page.apply(
      BrowsePageDraft(
        title: overviewDraft.title, answer: overviewDraft.answer, sections: sectionsDraft.sections,
        followUps: sectionsDraft.followUps),
      finished: finished)
  }

  private func isCurrent(_ run: Int) -> Bool {
    run == runID && !Task.isCancelled
  }

  private func fail(_ failure: BrowseFailure) {
    for index in sources.indices where [.queued, .reading, .condensing].contains(sources[index].state) {
      sources[index].state = .skipped
    }
    phase = .failed(failure)
  }

  private enum ReadOutcome: Sendable {
    case read(Int, ReadablePage)
    case failed(Int)
    case deadline
  }

  private func read(_ candidates: [SearchResult], run: Int) async {
    let limit = configuration.sourceLimit
    let deadline = configuration.readingDeadline
    let sourcing = sourcing
    var backlog = Array(candidates.enumerated())[...]
    sources = candidates.prefix(limit).enumerated().map { index, result in
      SourceProgress(id: index, result: result, state: .queued, siteName: result.displayHost)
    }

    await withTaskGroup(of: ReadOutcome.self) { group in
      var running = 0
      var readCount = 0

      @MainActor func launch(_ index: Int, _ result: SearchResult) {
        if let position = sources.firstIndex(where: { $0.id == index }) {
          sources[position].state = .reading
        } else {
          sources.append(SourceProgress(id: index, result: result, state: .reading, siteName: result.displayHost))
        }
        running += 1
        group.addTask {
          do {
            return .read(index, try await sourcing.read(result))
          } catch {
            return .failed(index)
          }
        }
      }

      group.addTask {
        try? await Task.sleep(for: deadline)
        return .deadline
      }
      while running < limit, let next = backlog.popFirst() { launch(next.offset, next.element) }

      for await outcome in group {
        guard isCurrent(run) else {
          group.cancelAll()
          return
        }
        switch outcome {
        case .deadline:
          group.cancelAll()
          return
        case .read(let index, let readable):
          running -= 1
          readCount += 1
          readPages[index] = readable
          update(index) {
            $0.state = .read
            $0.siteName = readable.siteName
            $0.imageURL = readable.imageURL
          }
        case .failed(let index):
          running -= 1
          update(index) { $0.state = .failed }
          if readCount + running < limit, let next = backlog.popFirst() { launch(next.offset, next.element) }
        }
        if running == 0 {
          group.cancelAll()
          return
        }
      }
    }
    for index in sources.indices where sources[index].state == .reading || sources[index].state == .queued {
      sources[index].state = .skipped
    }
  }

  private func update(_ id: Int, _ change: (inout SourceProgress) -> Void) {
    guard let position = sources.firstIndex(where: { $0.id == id }) else { return }
    change(&sources[position])
  }

  private func writeSections(_ readIDs: [Int], language: (code: String, name: String), today: Date, run: Int) async {
    let instructions = Prompts.sectionsInstructions(today: today)
    var used = readIDs
    var scale = 1.0
    for attempt in 0..<3 {
      timing.attempts = attempt + 1
      let prompt = await buildPrompt(for: used, instructions: instructions, language: language.name, scale: scale, run: run)
      guard isCurrent(run) else { return }
      phase = .writing
      timing.sectionsStart = timing.sectionsStart ?? started.duration(to: clock.now)
      sectionsDraft = BrowsePageDraft()
      page.sources = numberedSources(used)
      page.heroImages = heroImages(among: used)
      applyDrafts(finished: false)
      do {
        sectionsDraft = try await consume(
          model.streamSections(instructions: instructions, prompt: prompt), part: .sections, run: run)
        guard isCurrent(run) else { return }
        applyDrafts(finished: true)
        guard !page.sections.isEmpty || !page.answer.isEmpty else {
          fail(.generationFailed)
          return
        }
        timing.total = started.duration(to: clock.now)
        phase = .done
        return
      } catch IntelligenceError.contextExceeded where attempt < 2 {
        guard isCurrent(run) else { return }
        if used.count > 2 { used.removeLast(used.count > 4 ? 2 : 1) }
        scale *= 0.6
      } catch let error as IntelligenceError {
        guard isCurrent(run) else { return }
        switch error {
        case .guardrail, .refusal, .unsupportedLanguage, .unavailable:
          fail(BrowseFailure(error))
        case .contextExceeded, .rateLimited, .timedOut, .failed:
          finishWithAnswerOnly(or: BrowseFailure(error))
        }
        return
      } catch {
        guard isCurrent(run) else { return }
        finishWithAnswerOnly(or: .generationFailed)
        return
      }
    }
    finishWithAnswerOnly(or: .tooMuchToRead)
  }

  private func finishWithAnswerOnly(or failure: BrowseFailure) {
    guard !page.answer.isEmpty else {
      fail(failure)
      return
    }
    sectionsDraft = BrowsePageDraft()
    applyDrafts(finished: true)
    timing.total = started.duration(to: clock.now)
    phase = .done
  }

  private func numberedSources(_ ids: [Int]) -> [BrowseSource] {
    ids.enumerated().compactMap { offset, id in
      guard let progress = sources.first(where: { $0.id == id }) else { return nil }
      let readable = readPages[id]
      return BrowseSource(
        number: offset + 1, url: progress.result.url, title: readable?.title ?? progress.result.title,
        siteName: progress.siteName, snippet: progress.result.snippet, faviconURL: progress.faviconURL,
        imageURL: progress.imageURL)
    }
  }

  private func heroImages(among ids: [Int]) -> [URL] {
    var images: [URL] = []
    for id in ids {
      guard let image = readPages[id]?.imageURL, !images.contains(image) else { continue }
      images.append(image)
      if images.count == 3 { break }
    }
    return images
  }

  private func pageLanguage() -> (code: String, name: String) {
    let preferred = Prompts.languageName(for: "")
    guard configuration.language == .inferFromQuery else { return preferred }
    let inferred = Prompts.languageName(for: query)
    return model.supportsLanguage(inferred.code) ? inferred : preferred
  }

  private func consume(
    _ stream: AsyncThrowingStream<BrowsePageDraft, any Error>, part: StreamPart, run: Int
  ) async throws -> BrowsePageDraft {
    let started = started
    lastStreamProgress = clock.now
    streamHasStarted = false
    let consumer = Task { @MainActor in
      var lastDraft = BrowsePageDraft()
      for try await draft in stream {
        guard self.isCurrent(run) else { break }
        lastDraft = draft
        self.lastStreamProgress = self.clock.now
        self.streamHasStarted = true
        switch part {
        case .overview: self.overviewDraft = draft
        case .sections: self.sectionsDraft = draft
        }
        self.applyDrafts(finished: false)
        if self.timing.title == nil, !self.page.title.isEmpty {
          self.timing.title = started.duration(to: self.clock.now)
        }
        if self.timing.firstSection == nil,
          self.page.sections.contains(where: { !$0.heading.isEmpty && !$0.bullets.isEmpty })
        {
          self.timing.firstSection = started.duration(to: self.clock.now)
        }
      }
      return lastDraft
    }
    let firstDraftTimeout = configuration.firstDraftTimeout
    let stallTimeout = configuration.stallTimeout
    let watchdog = Task { @MainActor in
      let watchStarted = self.clock.now
      while !Task.isCancelled {
        let wake =
          self.streamHasStarted
          ? self.lastStreamProgress + stallTimeout
          : min(watchStarted + firstDraftTimeout, self.clock.now + stallTimeout)
        try? await Task.sleep(until: wake, clock: .continuous)
        guard !Task.isCancelled else { return }
        let now = self.clock.now
        let stalled =
          self.streamHasStarted
          ? self.lastStreamProgress + stallTimeout <= now
          : watchStarted + firstDraftTimeout <= now
        if stalled {
          consumer.cancel()
          return
        }
      }
    }
    defer { watchdog.cancel() }
    return try await withTaskCancellationHandler {
      try await consumer.value
    } onCancel: {
      consumer.cancel()
    }
  }

  public var statusText: String {
    switch phase {
    case .idle, .searching:
      BrowseCopy.searching
    case .reading:
      BrowseCopy.reading(sources.filter { $0.state != .failed && $0.state != .skipped }.count)
    case .writing:
      BrowseCopy.writing
    case .done:
      BrowseCopy.read(page.sources.count)
    case .failed(let failure):
      failure.message
    case .cancelled:
      ""
    }
  }

  private func buildPrompt(for ids: [Int], instructions: String, language: String, scale: Double, run: Int) async -> String {
    let context = model.contextSize
    let instructionTokens = await model.tokenCount(of: instructions) ?? TokenEstimate.tokens(in: instructions)
    let schemaTokens = await model.schemaTokens(for: .sections) ?? 650
    let headerTokens = ids.count * 30 + TokenEstimate.tokens(in: query) + 30
    let promptBudget = context - instructionTokens - schemaTokens - configuration.responseReserve - context / 16
    let available = max(ids.count * 60, Int(Double(min(promptBudget - headerTokens, configuration.sourceTokenLimit)) * scale))

    if available / max(ids.count, 1) < configuration.minimumTokensPerSource {
      await condense(ids, context: context, run: run)
    }

    let terms = QueryTerms(query)
    var budget = available
    var prompt = ""
    for _ in 0..<2 {
      let blocks = ids.map { condensedBlocks[$0] ?? readPages[$0]?.blocks ?? [] }
      let demands = blocks.map { min(budget, $0.reduce(0) { $0 + TokenEstimate.tokens(in: $1.text) + 1 }) }
      let shares = TokenAllocator.fairShares(demands: demands, total: budget)
      let entries = ids.enumerated().map { offset, id in
        let selected = PassageSelector.select(blocks[offset], terms: terms, tokenLimit: shares[offset])
        let progress = sources.first { $0.id == id }
        return (
          number: offset + 1, title: readPages[id]?.title ?? progress?.result.title ?? "",
          site: progress?.siteName ?? "", text: selected.map(\.text).joined(separator: "\n")
        )
      }
      prompt = Prompts.sectionsPrompt(
        question: query, language: language, answer: page.answer, sources: entries)
      guard let measured = await model.tokenCount(of: prompt), measured > Int(Double(promptBudget) * scale) else { break }
      budget = Int(Double(budget) * Double(promptBudget) * scale / Double(measured) * 0.92)
    }
    return prompt
  }

  private func condense(_ ids: [Int], context: Int, run: Int) async {
    let terms = QueryTerms(query)
    let limit = context - (await model.tokenCount(of: Prompts.notesInstructions) ?? 120) - 500 - context / 16
    for id in ids where condensedBlocks[id] == nil {
      guard isCurrent(run), let readable = readPages[id] else { return }
      update(id) { $0.state = .condensing }
      let text = PassageSelector.select(readable.blocks, terms: terms, tokenLimit: limit).map(\.text).joined(separator: "\n")
      do {
        let notes = try await model.condense(
          instructions: Prompts.notesInstructions,
          prompt: Prompts.notesPrompt(question: query, title: readable.title, text: text))
        let lines = notes.split(whereSeparator: \.isNewline).map {
          $0.trimmingCharacters(in: CharacterSet(charactersIn: "-\u{2022}* ").union(.whitespaces))
        }.filter { !$0.isEmpty }
        condensedBlocks[id] = lines.map { TextBlock(kind: .paragraph, text: $0) }
      } catch {
        guard isCurrent(run) else { return }
      }
      update(id) { $0.state = .read }
    }
  }

  static func searchFailure(_ error: any Error) -> BrowseFailure {
    switch error as? SourceError {
    case .offline: .offline
    default: .searchUnavailable
    }
  }
}

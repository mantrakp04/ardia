import ArdiaBrowser
import Foundation
import FoundationModels
import Observation

@MainActor
@Observable
final class ResearchSession: Identifiable {
  enum Phase: Equatable {
    case searching
    case reading(done: Int, total: Int)
    case writing
    case done
    case failed(String)
  }

  enum Writer: Equatable {
    case onDevice
    case excerpts(reason: String)
  }

  static let responseTokens = 650
  static let instructionTokens = 260
  static let charactersPerToken = 3
  static let readConcurrency = 3

  struct PageRead: Sendable {
    var index: Int
    var content: ReadableContent?
  }

  let id = UUID()
  let query: String
  let forcesExcerpts: Bool
  private(set) var phase: Phase = .searching
  private(set) var links: [ResearchLink] = []
  private(set) var sources: [ResearchSource] = []
  private(set) var answer = ""
  private(set) var writer: Writer?
  let readAloud = ReadAloud()

  @ObservationIgnored private var task: Task<Void, Never>?
  @ObservationIgnored private let loader = ResearchPageLoader()

  init(query: String, forcesExcerpts: Bool = false) {
    self.query = query
    self.forcesExcerpts = forcesExcerpts
  }

  var isFinished: Bool {
    switch phase {
    case .done, .failed: true
    default: false
    }
  }

  func start() {
    guard task == nil else { return }
    task = Task { await run() }
  }

  func retry() {
    task?.cancel()
    task = nil
    phase = .searching
    links = []
    sources = []
    answer = ""
    writer = nil
    readAloud.reset()
    start()
  }

  func cancel() {
    task?.cancel()
    task = nil
    readAloud.stop()
  }

  func source(_ number: Int) -> ResearchSource? {
    sources.first { $0.id == number }
  }

  private func run() async {
    do {
      links = try await loader.searchLinks(for: query)
      try Task.checkCancellation()
      guard !links.isEmpty else {
        phase = .failed(String(localized: "Couldn’t find pages for this search."))
        return
      }
      sources = try await readSources(links)
      guard !sources.isEmpty else {
        phase = .failed(String(localized: "Couldn’t read any of the pages for this search."))
        return
      }
      phase = .writing
      try await write()
      try Task.checkCancellation()
      phase = .done
      readAloud.answerReady(ResearchAnswer.spoken(answer))
    } catch is CancellationError {
    } catch {
      phase = .failed(String(localized: "Couldn’t reach the web. Check your connection and try again."))
    }
  }

  private func readSources(_ links: [ResearchLink]) async throws -> [ResearchSource] {
    phase = .reading(done: 0, total: links.count)
    var pages: [Int: ReadableContent] = [:]
    var done = 0
    let loader = loader
    await withTaskGroup(of: PageRead.self) { group in
      var next = 0
      while next < min(Self.readConcurrency, links.count) {
        let index = next
        let link = links[index]
        group.addTask { PageRead(index: index, content: await loader.read(link)) }
        next += 1
      }
      while let read = await group.next() {
        done += 1
        phase = .reading(done: done, total: links.count)
        if let content = read.content { pages[read.index] = content }
        if next < links.count {
          let index = next
          let link = links[index]
          group.addTask { PageRead(index: index, content: await loader.read(link)) }
          next += 1
        }
      }
    }
    try Task.checkCancellation()
    var sources: [ResearchSource] = []
    for (index, link) in links.enumerated() {
      guard let page = pages[index], page.paragraphs.reduce(0, { $0 + $1.count }) >= ResearchDigest.minimumSourceCharacters else { continue }
      let host = link.url.host()?.replacingOccurrences(of: "www.", with: "") ?? link.url.absoluteString
      sources.append(ResearchSource(
        id: sources.count + 1,
        url: link.url,
        title: page.title.isEmpty ? link.title : page.title,
        siteName: page.siteName.isEmpty ? host : page.siteName,
        paragraphs: page.paragraphs
      ))
    }
    return sources
  }

  private func write() async throws {
    let model = SystemLanguageModel.default
    if forcesExcerpts {
      quoteSources(reason: String(localized: "Showing the most relevant lines from the pages."))
      return
    }
    guard case .available = model.availability else {
      quoteSources(reason: Self.unavailableReason(model.availability))
      return
    }
    let budget = max((model.contextSize - Self.responseTokens - Self.instructionTokens) * Self.charactersPerToken, 2000)
    for share in [budget, budget / 2] {
      do {
        try await stream(model: model, characterBudget: share)
        writer = .onDevice
        return
      } catch is CancellationError {
        throw CancellationError()
      } catch {
        answer = ""
      }
    }
    quoteSources(reason: String(localized: "Apple Intelligence couldn’t answer this one, so here are the most relevant lines from the pages."))
  }

  private func stream(model: SystemLanguageModel, characterBudget: Int) async throws {
    let session = LanguageModelSession(model: model, instructions: ResearchDigest.instructions)
    let prompt = ResearchDigest.prompt(query: query, sources: sources, characterBudget: characterBudget)
    let options = GenerationOptions(temperature: 0.3, maximumResponseTokens: Self.responseTokens)
    for try await snapshot in session.streamResponse(to: prompt, options: options) {
      try Task.checkCancellation()
      answer = snapshot.content
    }
  }

  private func quoteSources(reason: String) {
    answer = ResearchDigest.extractiveAnswer(query: query, sources: sources)
    writer = .excerpts(reason: reason)
  }

  static func unavailableReason(_ availability: SystemLanguageModel.Availability) -> String {
    switch availability {
    case .unavailable(.appleIntelligenceNotEnabled):
      String(localized: "Turn on Apple Intelligence in Settings for a written answer. Until then, here are the most relevant lines from the pages.")
    case .unavailable(.modelNotReady):
      String(localized: "Apple Intelligence is still downloading. Until it’s ready, here are the most relevant lines from the pages.")
    default:
      String(localized: "This iPhone can’t run Apple Intelligence, so here are the most relevant lines from the pages.")
    }
  }
}

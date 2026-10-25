import Foundation
import Testing

@testable import ArdiaIntelligence

@MainActor
struct BrowseForMeTests {
  @Test func `reads the sources, streams the page and finishes with clean citations`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let browse = BrowseForMe(query: "are carbon plate shoes worth it", model: model, sourcing: Sample.sourcing(3))

    await browse.run()

    #expect(browse.phase == .done)
    #expect(browse.sources.map(\.state) == [.read, .read, .read])
    let page = browse.page
    #expect(page.title == "Carbon Plate Shoes")
    #expect(page.answer == "They save energy at race pace.")
    #expect(page.sections.map(\.heading) == ["Energy", "Everyday use"])
    let first = page.sections[0].bullets[0]
    #expect(first.text == "Lab tests show savings")
    #expect(first.citations == [1, 2])
    #expect(first.emoji == "\u{26A1}")
    #expect(first.lead == "Savings")
    let second = page.sections[1].bullets[0]
    #expect(second.emoji.isEmpty)
    #expect(second.lead == "Rotation")
    #expect(second.text == "Rotate two pairs.")
    #expect(page.sections[1].bullets[1].lead.isEmpty)
    #expect(page.sections[1].bullets[1].text == "Most runners own a race pair and a daily pair.")
    #expect(browse.statusText == "Read 3 pages")
    #expect(page.followUps == ["Are they worth it?", "Do they cause injuries?", "Which brands lead?"])
    #expect(page.sources.map(\.number) == [1, 2, 3])
    #expect(page.sources.map(\.siteName) == ["Site 1", "Site 2", "Site 3"])
    #expect(page.heroImages.map(\.absoluteString) == (1...3).map { "https://site\($0).example/hero.jpg" })
    #expect(browse.timing.firstSection != nil)

    let prompt = try #require(model.recorded.pagePrompts.first)
    #expect(prompt.hasPrefix("Question: are carbon plate shoes worth it"))
    #expect(prompt.contains("[1] Article 1 (Site 1)"))
    #expect(prompt.contains("[3] Article 3 (Site 3)"))
  }

  @Test func `the title and answer come from the search snippets before the pages are read`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let browse = BrowseForMe(query: "carbon plates", model: model, sourcing: Sample.sourcing(3))

    await browse.run()

    let overviewPrompt = try #require(model.recorded.overviewPrompts.first)
    #expect(overviewPrompt.contains("[1] Result 1 (site1.example): Snippet for result 1."))
    #expect(!overviewPrompt.contains("lab tests on twenty runners"))
    let title = try #require(browse.timing.title)
    let sectionsStart = try #require(browse.timing.sectionsStart)
    #expect(title <= sectionsStart)
    #expect(model.recorded.prewarmed.first == Prompts.overviewInstructions())
    let sectionsPrompt = try #require(model.recorded.pagePrompts.first)
    #expect(sectionsPrompt.contains("The page's answer: They save energy at race pace."))
  }

  @Test func `sections start once enough pages are read instead of waiting for slow sites`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let sourcing = Sample.sourcing(6, overrides: [5: .hang, 6: .hang])
    var configuration = BrowseForMe.Configuration()
    configuration.readingGrace = .milliseconds(50)
    let browse = BrowseForMe(query: "carbon plates", model: model, sourcing: sourcing, configuration: configuration)

    await browse.run()

    #expect(browse.phase == .done)
    #expect(browse.page.sources.count == 4)
    #expect(browse.sources.filter { $0.state == .skipped }.map(\.id) == [4, 5])
    #expect(await eventually { sourcing.log.count("cancelled") == 2 })
  }

  @Test func `when no page opens the answer from the snippets still stands`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let browse = BrowseForMe(
      query: "carbon plates", model: model, sourcing: Sample.sourcing(3, overrides: [1: .fail, 2: .fail, 3: .fail]))

    await browse.run()

    #expect(browse.phase == .done)
    #expect(browse.page.answer == "They save energy at race pace.")
    #expect(browse.page.sections.isEmpty)
    #expect(browse.page.sources.map(\.snippet) == ["Snippet for result 1.", "Snippet for result 2.", "Snippet for result 3."])
    #expect(model.recorded.pagePrompts.isEmpty)
  }

  @Test func `a failed body keeps the answer it already wrote`() async throws {
    let model = FakeModel(pages: [.fail(.failed)])
    let browse = BrowseForMe(query: "carbon plates", model: model, sourcing: Sample.sourcing(3))

    await browse.run()

    #expect(browse.phase == .done)
    #expect(browse.page.title == "Carbon Plate Shoes")
    #expect(browse.page.answer == "They save energy at race pace.")
    #expect(browse.page.sections.isEmpty)
    #expect(browse.page.sources.count == 3)
  }

  @Test func `a failed source is replaced by the next site and left out of the numbering`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let browse = BrowseForMe(query: "running shoes", model: model, sourcing: Sample.sourcing(8, overrides: [2: .fail]))

    await browse.run()

    #expect(browse.phase == .done)
    #expect(browse.sources.first { $0.id == 1 }?.state == .failed)
    #expect(browse.sources.filter { $0.state == .read }.map(\.id) == [0, 2, 3, 4, 5, 6])
    #expect(browse.page.sources.map(\.number) == [1, 2, 3, 4, 5, 6])
    #expect(browse.page.sources.map(\.siteName) == ["Site 1", "Site 3", "Site 4", "Site 5", "Site 6", "Site 7"])
  }

  @Test func `cancelling while reading stops every fetch and never asks the model`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let sourcing = Sample.sourcing(4, overrides: [1: .hang, 2: .hang, 3: .hang, 4: .hang])
    let browse = BrowseForMe(query: "slow sites", model: model, sourcing: sourcing)

    browse.start()
    #expect(await eventually { browse.sources.count == 4 && browse.sources.allSatisfy { $0.state == .reading } })
    browse.cancel()

    #expect(browse.phase == .cancelled)
    #expect(browse.sources.allSatisfy { $0.state == .skipped })
    #expect(await eventually { sourcing.log.count("cancelled") == 4 })
    #expect(model.recorded.pagePrompts.isEmpty)
  }

  @Test func `cancelling while writing ends the model stream and keeps what was written`() async throws {
    let model = FakeModel(pages: [.draftsThenHang(Array(Sample.drafts.prefix(1)))])
    let browse = BrowseForMe(query: "carbon plates", model: model, sourcing: Sample.sourcing(2))

    browse.start()
    #expect(await eventually { browse.phase == .writing && browse.page.sections.count == 1 })
    browse.cancel()

    #expect(browse.phase == .cancelled)
    #expect(await eventually { model.recorded.cancelledStreams == 1 })
    #expect(browse.page.title == "Carbon Plate Shoes")
  }

  @Test func `a stream that stops making progress is finished with what it wrote`() async throws {
    let model = FakeModel(pages: [.draftsThenHang(Array(Sample.drafts.prefix(1)))])
    var configuration = BrowseForMe.Configuration()
    configuration.stallTimeout = .milliseconds(150)
    let browse = BrowseForMe(query: "carbon plates", model: model, sourcing: Sample.sourcing(2), configuration: configuration)

    await browse.run()

    #expect(browse.phase == .done)
    #expect(browse.page.sections.map(\.heading) == ["Energy"])
    #expect(model.recorded.cancelledStreams == 1)
  }

  @Test func `running out of context retries with fewer and shorter sources`() async throws {
    let model = FakeModel(pages: [.fail(.contextExceeded), .drafts(Sample.drafts)])
    let browse = BrowseForMe(query: "carbon plates", model: model, sourcing: Sample.sourcing(6))

    await browse.run()

    #expect(browse.phase == .done)
    #expect(browse.timing.attempts == 2)
    let prompts = model.recorded.pagePrompts
    #expect(prompts.count == 2)
    #expect(prompts[0].contains("[6] Article 6"))
    #expect(prompts[1].contains("[4] Article 4"))
    #expect(!prompts[1].contains("[5] "))
    #expect(browse.page.sources.count == 4)
  }

  enum Scenario: String, CaseIterable, Sendable {
    case offline, noResults, everySourceFails, guardrail, appleIntelligenceOff
  }

  @Test(arguments: Scenario.allCases)
  func `failures explain themselves and keep the sources when they can`(_ scenario: Scenario) async throws {
    var sourcing = Sample.sourcing(3)
    var model = FakeModel(pages: [.drafts(Sample.drafts)])
    let expected: BrowseFailure
    switch scenario {
    case .offline:
      sourcing.search = .failure(.offline)
      expected = .offline
    case .noResults:
      sourcing.search = .success([])
      expected = .noResults
    case .everySourceFails:
      sourcing = Sample.sourcing(3, overrides: [1: .fail, 2: .fail, 3: .fail])
      model = FakeModel(overviews: [.fail(.failed)])
      expected = .sourcesUnreachable
    case .guardrail:
      model = FakeModel(pages: [.fail(.guardrail)])
      expected = .guardrail
    case .appleIntelligenceOff:
      model = FakeModel(status: .appleIntelligenceOff)
      expected = .modelUnavailable(.appleIntelligenceOff)
    }
    let browse = BrowseForMe(query: "anything", model: model, sourcing: sourcing)

    await browse.run()

    #expect(browse.phase == .failed(expected))
    #expect(browse.failure?.showsSources == !browse.sources.isEmpty)
    #expect(!browse.sources.contains { [.queued, .reading, .condensing].contains($0.state) })
    if scenario == .appleIntelligenceOff {
      #expect(sourcing.log.count("read") == 0)
      #expect(browse.results.map(\.snippet) == ["Snippet for result 1.", "Snippet for result 2.", "Snippet for result 3."])
      #expect(expected.offersSettingsLink)
    }
  }
}

struct BrowsePageTests {
  @Test @MainActor func `a finished page survives a round trip and reopens without generating`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let browse = BrowseForMe(query: "carbon plates", model: model, sourcing: Sample.sourcing(3))
    await browse.run()

    let payload = try browse.page.payload()
    let decoded = try BrowsePage(payload: payload)
    #expect(decoded == browse.page)

    let reopened = BrowseForMe(restoring: decoded, model: model, sourcing: Sample.sourcing(3))
    #expect(reopened.phase == .done)
    #expect(reopened.sources.map(\.id) == [1, 2, 3])
    #expect(model.recorded.pagePrompts.count == 1)
  }

  @Test func `a page from a newer app version is refused instead of misread`() throws {
    var json = try JSONSerialization.jsonObject(with: BrowsePage(query: "q", title: "T").payload()) as! [String: Any]
    json["version"] = BrowsePage.schemaVersion + 1
    let data = try JSONSerialization.data(withJSONObject: json)

    #expect(throws: BrowsePage.DecodingFailure.newerVersion(BrowsePage.schemaVersion + 1)) {
      try BrowsePage(payload: data)
    }
  }
}

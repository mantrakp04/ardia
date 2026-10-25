import Foundation
import Testing

@testable import ArdiaIntelligence

@MainActor
struct PageSummarizerTests {
  private func longPage(paragraphs: Int) -> PageText {
    PageText(
      url: URL(string: "https://example.com/long"), title: "A Long Read", siteName: "Example",
      paragraphs: (1...paragraphs).map {
        "Paragraph \($0) explains one more detail about how the city rebuilt its tram network after the floods, who paid for it, and how long each stage took."
      })
  }

  @Test func `a long page is summarized in parts, then from the notes`() async throws {
    let model = FakeModel(
      contextSize: 1_200,
      summaries: [
        PageSummary(headline: "The city rebuilt"),
        PageSummary(
          headline: "The city rebuilt its trams.",
          points: [
            SummaryPoint(symbol: "calendar", label: "Timeline", text: "Rebuilt in stages."),
            SummaryPoint(symbol: "", label: "Cost", text: "Paid by the city."),
            SummaryPoint(symbol: "", label: "Cut", text: ""),
          ]),
      ])
    let summarizer = PageSummarizer(page: longPage(paragraphs: 60), model: model)

    await summarizer.runSummary()

    #expect(summarizer.phase == .done)
    #expect(summarizer.summary.headline == "The city rebuilt its trams.")
    #expect(summarizer.summary.points.map(\.symbol) == ["calendar", SummaryPoint.fallbackSymbol])
    #expect(summarizer.summary.points.map(\.label) == ["Timeline", "Cost"])
    let record = model.recorded
    #expect(record.condensePrompts.count > 1)
    #expect(record.condensePrompts.count <= PageSummarizer.maximumChunks)
    let summaryPrompt = try #require(record.summaryPrompts.first)
    #expect(summaryPrompt.contains("Note 1 from part 1."))
    #expect(!summaryPrompt.contains("Paragraph 1 explains"))
  }

  @Test func `a short page is summarized in one pass`() async throws {
    let model = FakeModel(summaries: [PageSummary(headline: "Short.", points: [SummaryPoint(symbol: "star", label: "One", text: "One.")])])
    let summarizer = PageSummarizer(page: longPage(paragraphs: 4), model: model)

    await summarizer.runSummary()

    #expect(summarizer.phase == .done)
    #expect(model.recorded.condensePrompts.isEmpty)
    #expect(model.recorded.summaryPrompts.first?.contains("Paragraph 4 explains") == true)
  }

  @Test func `follow-up questions share one conversation about the page`() async throws {
    let model = FakeModel(answers: ["It took six years.", "The city and the state paid."])
    let summarizer = PageSummarizer(page: longPage(paragraphs: 8), model: model)

    summarizer.ask(question: "How long did it take?")
    summarizer.ask(question: "Who paid?")

    #expect(await eventually { summarizer.exchanges.allSatisfy { $0.state == .answered } })
    #expect(summarizer.exchanges.map(\.answer) == ["It took six years.", "The city and the state paid."])
    let record = model.recorded
    #expect(record.conversationInstructions.count == 1)
    #expect(record.conversationInstructions[0].contains("Title: A Long Read"))
    #expect(record.questions.count == 2)
    #expect(record.questions[0] == "How long did it take?")
  }

  @Test func `a page without enough text says so instead of calling the model`() async {
    let model = FakeModel()
    let summarizer = PageSummarizer(
      page: PageText(url: nil, title: "Login", siteName: "Example", paragraphs: ["Sign in to continue."]), model: model)

    await summarizer.runSummary()

    #expect(summarizer.phase == .failed(.nothingToSummarize))
    #expect(model.recorded.summaryPrompts.isEmpty)
  }
}

import Foundation
import Testing

@testable import ArdiaIntelligence

@MainActor
struct FeatureGateTests {
  @Test func `with AI features off nothing searches, prewarms or asks the model, but saved pages still open`() async throws {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let sourcing = Sample.sourcing(3)
    let intelligence = Intelligence(model: model, sourcing: sourcing, isEnabled: false)

    intelligence.searchFieldDidBeginEditing()
    let browse = intelligence.browse("carbon plates")
    await browse.run()
    let summarizer = intelligence.summarizer(
      for: PageText(url: nil, title: "Page", siteName: "Site", paragraphs: Array(repeating: "A sentence with enough words to be worth reading here.", count: 8)))
    await summarizer.runSummary()
    summarizer.ask(question: "What is it about?")

    #expect(browse.phase == .failed(.featureOff))
    #expect(browse.failure?.opensExperiments == true)
    #expect(summarizer.phase == .failed(.featureOff))
    #expect(await eventually { summarizer.exchanges.first?.state == .failed(.featureOff) })
    #expect(sourcing.log.all.isEmpty)
    #expect(model.recorded.prewarmed.isEmpty)
    #expect(model.recorded.overviewPrompts.isEmpty)
    #expect(model.recorded.questions.isEmpty)

    let reopened = intelligence.reopen(BrowsePage(query: "carbon plates", title: "Saved", answer: "Kept."))
    #expect(reopened.phase == .done)
    #expect(reopened.page.answer == "Kept.")
  }

  @Test func `a run started from an Intelligence that is let go still sees the switch`() async {
    let model = FakeModel(pages: [.drafts(Sample.drafts)])
    let browse = Intelligence(model: model, sourcing: Sample.sourcing(3), isEnabled: true).browse("carbon plates")

    await browse.run()

    #expect(browse.phase == .done)
  }
}

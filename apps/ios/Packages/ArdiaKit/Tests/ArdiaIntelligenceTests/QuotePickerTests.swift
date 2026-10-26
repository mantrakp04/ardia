import Foundation
import Testing

@testable import ArdiaIntelligence

@MainActor
struct QuotePickerTests {
  @Test func `a finished page quotes a sentence from its sources that answers the question`() async throws {
    let browse = BrowseForMe(
      query: "are carbon plate shoes worth it", model: FakeModel(pages: [.drafts(Sample.drafts)]),
      sourcing: Sample.sourcing(3))

    await browse.run()

    let quote = try #require(browse.page.quote)
    #expect(quote.source == 1)
    #expect(quote.text.hasPrefix("Source 1 says carbon plated running shoes"))
    let restored = try BrowsePage(payload: browse.page.payload())
    #expect(restored.quote == quote)
  }

  @Test func `quotes are whole sentences of a readable length that share a word with the question`() {
    let page = ReadablePage(
      url: URL(string: "https://dogs.example")!, title: "Dogs", siteName: "Dogs", blocks: [
        TextBlock(kind: .heading, text: "Dogs were the first species to be domesticated by people."),
        TextBlock(kind: .paragraph, text: "Short one about dogs. Cats were domesticated much later than wolves were, in the Near East."),
        TextBlock(kind: .paragraph, text: "Dogs were the first species to be domesticated, more than 15,000 years ago. See [3]."),
      ])

    let quote = QuotePicker.pick(for: "what are dogs", from: [(source: 2, page: page)])

    #expect(quote == BrowseQuote(text: "Dogs were the first species to be domesticated, more than 15,000 years ago.", source: 2))
    #expect(QuotePicker.pick(for: "what are", from: [(source: 2, page: page)]) == nil)
    #expect(QuotePicker.pick(for: "hamsters", from: [(source: 2, page: page)]) == nil)
  }

  @Test func `pages saved before quotes existed still open`() throws {
    var page = BrowsePage(query: "dogs", title: "Dogs")
    page.quote = nil
    let payload = try page.payload()
    #expect(!String(decoding: payload, as: UTF8.self).contains("quote"))
    #expect(try BrowsePage(payload: payload).quote == nil)
  }
}

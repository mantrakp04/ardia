import Foundation
import Testing

@testable import ArdiaIntelligence

struct DuckDuckGoResultsTests {
  @Test func `skips ads, follows redirects and drops duplicates`() throws {
    let results = try DuckDuckGoResults.parse(Fixtures.duckDuckGoResults)

    #expect(results.map(\.url.absoluteString) == [
      "https://www.runnersworld.com/gear/a19663621/best-running-shoes/",
      "https://www.rtings.com/running-shoes/reviews/best/running?sort=new",
      "https://www.youtube.com/watch?v=abc123",
      "https://www.runnersworld.com/gear/a20000000/best-trail-shoes/",
      "https://en.m.wikipedia.org/wiki/Running_shoe",
    ])
    #expect(results[0].title == "The 15 Best Running Shoes of 2026, Tested by Runner's World")
    #expect(results[0].snippet == "Find the best running shoes of 2026, including picks from Adidas, Brooks & Hoka.")
    #expect(results[1].snippet.hasPrefix("If you want one pair of shoes"))
  }

  @Test func `picks one result per site and reads text sites before video sites`() throws {
    let results = try DuckDuckGoResults.parse(Fixtures.duckDuckGoResults)
    let picked = DuckDuckGoResults.distinctSites(results, limit: 6)

    #expect(picked.map(\.siteKey) == ["runnersworld.com", "rtings.com", "en.wikipedia.org", "youtube.com"])
  }

  @Test func `a bot challenge is reported instead of an empty result list`() {
    #expect(throws: DuckDuckGoResults.ParseError.blocked) {
      try DuckDuckGoResults.parse(Fixtures.duckDuckGoChallenge)
    }
  }
}

struct ReadableExtractorTests {
  private let articleURL = URL(string: "https://www.dailycourier.example/news/2026/10/rail-strike")!

  @Test func `a news article keeps its story and drops the page around it`() {
    let page = ReadableExtractor.extract(html: Fixtures.newsArticle, url: articleURL)

    #expect(page.title == "Rail strike called off after late-night deal")
    #expect(page.siteName == "The Daily Courier")
    #expect(page.language == "en-GB")
    #expect(page.imageURL?.absoluteString == "https://www.dailycourier.example/images/2026/10/station-crowd.jpg")
    #expect(page.iconURL?.absoluteString == "https://www.dailycourier.example/touch-icon-180.png")
    #expect(page.hasReadableText)
    #expect(page.blocks.first?.text == "Rail strike called off after late-night deal")
    #expect(page.blocks.contains { $0.kind == .heading && $0.text == "What happens next" })
    #expect(page.text.contains("a 6% rise over two years"))
    for boilerplate in ["cookies", "Sign up", "Related stories", "Fares to rise", "Most read", "Storm warnings", "All rights reserved", "Sam Patel", "Sport"] {
      #expect(!page.text.contains(boilerplate), "\(boilerplate) should not be in the readable text")
    }
  }

  @Test func `a recipe keeps its ingredients and method as list items`() {
    let page = ReadableExtractor.extract(html: Fixtures.recipe, url: URL(string: "https://hearthhome.example/banana-bread")!)

    #expect(page.title == "The Best Banana Bread")
    #expect(page.siteName == "Hearth & Home Kitchen")
    let items = page.blocks.filter { $0.kind == .listItem }
    #expect(items.count == 13)
    #expect(Set(items.prefix(8).map(\.group)).count == 1)
    #expect(items[0].group != items[8].group)
    #expect(!page.text.contains("Advertisement"))
    #expect(!page.text.contains("comments"))
  }

  @Test func `a page that is mostly navigation has nothing to read`() {
    let page = ReadableExtractor.extract(html: Fixtures.mostlyNavigation, url: URL(string: "https://acme.example/")!)

    #expect(!page.hasReadableText)
    for navigation in ["Jackets", "Sign in", "Store finder", "Alpine down jacket", "Shop the sale"] {
      #expect(!page.text.contains(navigation))
    }
  }

  @Test func `entities, raw text and unclosed tags do not leak into the text`() {
    let html = """
      <body><main><p>Fish &amp; chips cost &pound;9&nbsp;today &#8212; or &#x24;12 &bogus; here.
      <script>var a = "<p>not text</p>";</script><p>Second paragraph that is long enough to keep around.<!-- <p>hidden</p> -->
      </main></body>
      """
    let page = ReadableExtractor.extract(html: html, url: URL(string: "https://example.com")!)

    #expect(page.blocks.map(\.text) == [
      "Fish & chips cost \u{00A3}9 today \u{2014} or $12 &bogus; here.",
      "Second paragraph that is long enough to keep around.",
    ])
  }
}

struct TokenBudgetTests {
  @Test func `short sources keep all their text and long ones split the rest`() {
    #expect(TokenAllocator.fairShares(demands: [100, 2_000, 5_000], total: 1_500) == [100, 700, 700])
    #expect(TokenAllocator.fairShares(demands: [100, 200], total: 1_000) == [100, 200])
  }

  @Test func `a tight budget keeps the recipe and drops most of the preamble`() {
    let page = ReadableExtractor.extract(html: Fixtures.recipe, url: URL(string: "https://hearthhome.example/banana-bread")!)
    let limit = 220
    let selected = PassageSelector.select(page.blocks, terms: QueryTerms("banana bread recipe"), tokenLimit: limit)
    let text = selected.map(\.text).joined(separator: "\n")

    #expect(selected.reduce(0) { $0 + TokenEstimate.tokens(in: $1.text) + 1 } <= limit)
    #expect(text.contains("3 very ripe bananas, mashed"))
    #expect(text.contains("Mix the mashed bananas"))
    #expect(text.contains("Ingredients"))
    #expect(!text.contains("bus timetable"))
    #expect(!text.contains("walnuts"))
    #expect(selected.map(\.text) == page.blocks.map(\.text).filter(text.contains))
  }

  @Test func `a single passage longer than the budget is cut at a sentence`() {
    let paragraph = String(repeating: "The quick brown fox jumps over the lazy dog. ", count: 60)
    let selected = PassageSelector.select([TextBlock(kind: .paragraph, text: paragraph)], terms: QueryTerms("fox"), tokenLimit: 50)

    #expect(selected.count == 1)
    #expect(TokenEstimate.tokens(in: selected[0].text) <= 50)
    #expect(selected[0].text.hasSuffix("dog."))
  }
}

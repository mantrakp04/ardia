import Foundation
import Testing
import WebKit
@testable import ArdiaBrowser

@MainActor
final class PageLoader: NSObject, WKNavigationDelegate {
  private var continuation: CheckedContinuation<Void, any Error>?

  func load(_ html: String, base: String) async throws -> WKWebView {
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
    webView.navigationDelegate = self
    try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      webView.loadHTMLString(html, baseURL: URL(string: base))
    }
    return webView
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    continuation?.resume()
    continuation = nil
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
    continuation?.resume(throwing: error)
    continuation = nil
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
    continuation?.resume(throwing: error)
    continuation = nil
  }
}

enum ReaderFixtures {
  static let filler = "The town grew around its palaces and gardens, drawing painters, poets and travellers who described its misty hills, mossy walls and the strange mix of styles that still define it today."

  static let wikipedia = """
  <!doctype html><html lang="en"><head><title>Sintra - Wikipedia</title>
  <meta property="og:title" content="Sintra - Wikipedia"><meta property="og:site_name" content="Wikipedia">
  <style>.mw-parser-output .hatnote{font-style:italic}</style></head><body>
  <header class="header-container"><a href="/">Wikipedia</a><form><input placeholder="Search Wikipedia"></form></header>
  <main id="content"><div class="pre-content heading-holder"><h1 id="firstHeading"><span class="mw-page-title-main">Sintra</span></h1>
  <nav class="page-actions-menu"><ul><li><a href="#">Language</a></li><li><a href="#">Watch</a></li><li><a href="#">Edit</a></li></ul></nav></div>
  <div class="minerva__tab-container"><ul><li><a href="/wiki/Sintra">Article</a></li><li><a href="/wiki/Talk:Sintra">Talk</a></li></ul></div>
  <div id="bodyContent"><div id="mw-content-text"><div class="mw-parser-output">
  <style data-mw-deduplicate="TemplateStyles:r1">.mw-parser-output .IPA-label-small{font-size:85%}.mw-parser-output .references{font-size:90%}</style>
  <div role="note" class="hatnote navigation-not-searchable">For other uses, see Sintra (disambiguation).</div>
  <table class="infobox ib-settlement"><tr><th>Sintra</th></tr><tr><td>Municipality</td><td>Lisbon District</td></tr></table>
  <p><b>Sintra</b> (<span class="IPA"><style>.mw-parser-output .IPA a{text-decoration:none}</style>/ˈsɪntrə/</span>) is a town in the Greater Lisbon region of Portugal.<sup class="reference"><a href="#cite_note-1">[1]</a></sup><sup class="reference"><a href="#cite_note-2">[2]</a></sup> It is known for its 19th-century Romanticist architecture.<sup class="noprint Inline-Template">[citation needed]</sup></p>
  <div id="toc" class="toc"><div class="toctitle"><h2>Contents</h2></div><ul><li><a href="#History">1 History</a></li><li><a href="#Geography">2 Geography</a></li></ul></div>
  <h2><span class="mw-headline" id="History">History</span><span class="mw-editsection"><span class="mw-editsection-bracket">[</span><a href="#">edit</a><span class="mw-editsection-bracket">]</span></span></h2>
  <p>\(filler)<sup class="reference">[3]</sup></p>
  <p>\(filler) The Moors built a castle on the hilltop in the 8th and 9th centuries.</p>
  <h2><span class="mw-headline" id="Geography">Geography</span><span class="mw-editsection">[edit]</span></h2>
  <p>\(filler) The Serra de Sintra rises to 528 metres.</p>
  <p>\(filler) Its forests are protected as part of the Sintra-Cascais Natural Park.</p>
  <div role="navigation" class="navbox"><table><tr><td><a href="#">Municipalities of Lisbon District</a></td></tr></table></div>
  <h2 id="References">References</h2><div class="reflist"><ol class="references"><li id="cite_note-1"><span class="mw-cite-backlink">^</span> Instituto Nacional de Estatística</li></ol></div>
  </div></div></div></main>
  <footer class="footer"><ul><li><a href="#">Privacy policy</a></li><li><a href="#">About Wikipedia</a></li></ul></footer></body></html>
  """

  static let news = """
  <!doctype html><html lang="en-GB"><head><title>Storm brings floods to coastal towns - BBC News</title>
  <meta property="og:title" content="Storm brings floods to coastal towns"><meta property="og:site_name" content="BBC News">
  <meta name="author" content="Jane Reporter"><meta property="og:image" content="https://ichef.example/storm.jpg"></head><body>
  <header><nav><ul><li><a href="/">Home</a></li><li><a href="/news">News</a></li><li><a href="/sport">Sport</a></li></ul></nav></header>
  <div id="main-content"><article>
  <header><h1 id="main-heading">Storm brings floods to coastal towns</h1></header>
  <div data-component="byline-block"><span>Jane Reporter</span><span>Environment correspondent</span></div>
  <div data-component="text-block"><p><b>Hundreds of homes have been evacuated after a storm brought record rainfall to coastal towns overnight.</b></p></div>
  <div data-component="text-block"><p>\(filler)</p></div>
  <div data-component="subheadline-block"><h2>Rescue teams</h2></div>
  <div data-component="text-block"><p>Emergency services said they had rescued 40 people, many from cars stranded on flooded roads, and warned that more rain was expected.</p></div>
  <div data-component="text-block"><p>\(filler)</p></div>
  <div data-component="links-block"><h2>Related topics</h2><ul><li><a href="#">Flooding</a></li><li><a href="#">Weather</a></li><li><a href="#">Climate</a></li></ul></div>
  <section data-component="share" class="share-tools"><button>Share</button></section>
  </article></div>
  <aside><h2>Top stories</h2><ul><li><a href="#">Another headline about something else</a></li></ul></aside>
  <footer><p>Copyright 2026 BBC. The BBC is not responsible for the content of external sites.</p></footer></body></html>
  """

  static let recipe = """
  <!doctype html><html><head><title>Best Banana Bread | Sally Bakes</title>
  <meta property="og:title" content="Best Banana Bread | Sally Bakes"><meta property="og:site_name" content="Sally Bakes">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},{"@type":"Recipe","name":"Best Banana Bread","recipeIngredient":["3 ripe bananas","2 cups flour","1 tsp baking soda"],"recipeInstructions":[{"@type":"HowToStep","text":"Preheat the oven to 175 C."},{"@type":"HowToStep","text":"Mash the bananas and mix everything."},{"@type":"HowToStep","text":"Bake for 60 minutes."}]}]}</script>
  </head><body><nav class="site-nav"><ul><li><a href="#">Recipes</a></li><li><a href="#">About</a></li></ul></nav>
  <article class="post"><h1 class="entry-title">Best Banana Bread</h1>
  <a class="wprm-recipe-jump" href="#recipe">Jump to Recipe</a>
  <div class="entry-content">
  <p>Every family has a banana bread story, and mine starts in my grandmother’s kitchen on rainy Sunday afternoons.</p>
  <p>\(filler)</p><p>\(filler)</p>
  <div class="ad-container adthrive"><p>Advertisement</p></div>
  <div class="wprm-recipe-container" id="recipe"><h2 class="wprm-recipe-name">Best Banana Bread</h2>
  <div class="wprm-recipe-print"><a href="#">Print Recipe</a></div>
  <h3>Ingredients</h3><ul class="wprm-recipe-ingredients"><li>3 ripe bananas</li><li>2 cups flour</li><li>1 tsp baking soda</li></ul>
  <h3>Instructions</h3><ol><li>Preheat the oven to 175 C.</li><li>Mash the bananas and mix everything.</li><li>Bake for 60 minutes.</li></ol></div>
  </div></article>
  <div id="comments" class="comments"><h3>42 Comments</h3><p>Loved it! Made it twice already this week and my kids keep asking for more.</p></div></body></html>
  """

  static let blog = """
  <!doctype html><html><head><title>Why I Moved My Notes to Plain Text – Field Notes</title>
  <meta property="og:site_name" content="Field Notes"></head><body>
  <header class="site-header"><a href="/">Field Notes</a><nav><ul><li><a href="/archive">Archive</a></li><li><a href="/about">About</a></li></ul></nav></header>
  <div class="wrap"><div class="post-content"><h1>Why I Moved My Notes to Plain Text</h1>
  <p class="byline">By Sam Writer</p>
  <p>For ten years I kept my notes in a dozen apps, and every few years one of them shut down.</p>
  <p>\(filler)</p><blockquote><p>Files outlive formats, and formats outlive apps.</p></blockquote><p>\(filler)</p>
  <div class="share-buttons"><a href="#">Tweet</a><a href="#">Share</a></div></div>
  <div class="sidebar widget-area"><h3>Popular posts</h3><ul><li><a href="#">A year without a smartphone</a></li><li><a href="#">On slow software</a></li></ul><p>Subscribe to the newsletter for weekly essays and links.</p></div></div>
  <footer class="site-footer"><p>Made with care in a small town, powered by a static site generator.</p></footer></body></html>
  """
}

@MainActor
@Suite(.serialized) struct ReadableContentTests {
  func extract(_ html: String, base: String) async throws -> ReadableContent {
    let loader = PageLoader()
    let webView = try await loader.load(html, base: base)
    return try await ReadableContent.extract(from: webView)
  }

  func expectClean(_ content: ReadableContent) {
    let text = content.text
    #expect(!text.contains("{"), "CSS leaked into \(content.title)")
    #expect(!text.contains("mw-parser-output"))
    #expect(text.range(of: #"\[\d+\]"#, options: .regularExpression) == nil, "reference markers in \(content.title)")
    #expect(!content.paragraphs.contains { $0 == content.title || $0 == "• " + content.title })
  }

  @Test func wikipediaKeepsTheArticleAndDropsTheChrome() async throws {
    let content = try await extract(ReaderFixtures.wikipedia, base: "https://en.m.wikipedia.org/wiki/Sintra")
    expectClean(content)
    #expect(content.title == "Sintra")
    #expect(content.paragraphs.first?.hasPrefix("Sintra (/ˈsɪntrə/) is a town in the Greater Lisbon region of Portugal. It is known") == true)
    #expect(content.paragraphs.contains("History"))
    #expect(content.paragraphs.contains("Geography"))
    for junk in ["Article", "Talk", "• Article", "• Talk", "edit", "Contents", "Municipality", "For other uses", "Privacy policy", "Watch", "citation needed", "Instituto"] {
      #expect(!content.paragraphs.contains { $0 == junk || $0.contains(junk) && junk.count > 6 }, "\(junk) leaked")
    }
    #expect(content.isArticle)
  }

  @Test func newsArticleKeepsBodyAndSubheadings() async throws {
    let content = try await extract(ReaderFixtures.news, base: "https://www.bbc.com/news/articles/x")
    expectClean(content)
    #expect(content.title == "Storm brings floods to coastal towns")
    #expect(content.siteName == "BBC News")
    #expect(content.byline == "Jane Reporter")
    #expect(content.leadImage == "https://ichef.example/storm.jpg")
    #expect(content.paragraphs.first?.hasPrefix("Hundreds of homes") == true)
    #expect(content.paragraphs.contains("Rescue teams"))
    for junk in ["Home", "Sport", "Flooding", "Share", "Another headline", "Copyright"] {
      #expect(!content.paragraphs.contains { $0.contains(junk) }, "\(junk) leaked")
    }
  }

  @Test func recipeKeepsTheStoryIngredientsAndSteps() async throws {
    let content = try await extract(ReaderFixtures.recipe, base: "https://sallybakes.example/banana-bread")
    expectClean(content)
    #expect(content.title == "Best Banana Bread")
    #expect(content.paragraphs.contains("• 3 ripe bananas"))
    #expect(content.paragraphs.contains("• Bake for 60 minutes."))
    #expect(content.paragraphs.filter { $0.contains("3 ripe bananas") }.count == 1)
    for junk in ["Jump to Recipe", "Print Recipe", "Advertisement", "Comments", "Loved it", "Recipes", "About"] {
      #expect(!content.paragraphs.contains { $0.contains(junk) }, "\(junk) leaked")
    }
    #expect(content.isArticle)
  }

  @Test func recipeSchemaFillsInWhenThePageHidesTheCard() async throws {
    let page = ReaderFixtures.recipe.replacingOccurrences(of: #"<div class="wprm-recipe-container" id="recipe">"#, with: #"<div class="wprm-recipe-container" id="recipe" style="display:none">"#)
    let content = try await extract(page, base: "https://sallybakes.example/banana-bread")
    #expect(content.paragraphs.contains("Ingredients"))
    #expect(content.paragraphs.contains("• 2 cups flour"))
    #expect(content.paragraphs.contains("2. Mash the bananas and mix everything."))
  }

  @Test func blogKeepsThePostAndDropsSidebarAndFooter() async throws {
    let content = try await extract(ReaderFixtures.blog, base: "https://fieldnotes.example/plain-text")
    expectClean(content)
    #expect(content.title == "Why I Moved My Notes to Plain Text")
    #expect(content.paragraphs.contains("Files outlive formats, and formats outlive apps."))
    #expect(content.paragraphs.contains { $0.hasPrefix("For ten years") })
    for junk in ["Archive", "Tweet", "Popular posts", "Subscribe", "Made with care", "smartphone"] {
      #expect(!content.paragraphs.contains { $0.contains(junk) }, "\(junk) leaked")
    }
  }
}

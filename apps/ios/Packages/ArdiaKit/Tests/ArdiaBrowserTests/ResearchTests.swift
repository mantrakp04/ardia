import Foundation
import Testing
@testable import ArdiaBrowser

@Suite struct ResearchTests {
  @Test func resultsPageCarriesTheQuery() throws {
    let url = try #require(ResearchSearch.resultsPage(for: "best espresso grinder 2026"))
    #expect(url.absoluteString == "https://html.duckduckgo.com/html/?q=best%20espresso%20grinder%202026")
  }

  @Test func linksUnwrapRedirectsAndDropRepeatsAdsAndVideoSites() {
    let raw: [ResearchSearch.RawResult] = [
      .init(href: "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fguide%3Fa%3D1&rut=abc", title: "  The\n Guide "),
      .init(href: "https://duckduckgo.com/y.js?ad_domain=shop.com", title: "Ad"),
      .init(href: "https://example.com/other", title: "Same host"),
      .init(href: "https://www.youtube.com/watch?v=1", title: "Video"),
      .init(href: "javascript:void(0)", title: "Script"),
      .init(href: "https://news.site.org/story", title: ""),
      .init(href: "https://third.net/a", title: "Third"),
    ]
    let links = ResearchSearch.links(from: raw, limit: 2)
    #expect(links == [
      ResearchLink(url: URL(string: "https://www.example.com/guide?a=1")!, title: "The Guide"),
      ResearchLink(url: URL(string: "https://news.site.org/story")!, title: "news.site.org"),
    ])
  }

  @Test func linksFromTheResultsPage() {
    let html = """
      <div class="result results_links result--ad"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
      <a class="result__url" href="https://www.britannica.com/place/Mount-Everest">britannica.com</a>
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://www.britannica.com/place/Mount-Everest">Mount <b>Everest</b> | Height &amp; Facts</a></h2>
      <a class="result__a" rel="nofollow"
         href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FMount_Everest&amp;rut=1">Mount Everest &#x27;Sagarmatha&#x27;</a>
      """
    #expect(ResearchSearch.links(fromHTML: html) == [
      ResearchLink(url: URL(string: "https://www.britannica.com/place/Mount-Everest")!, title: "Mount Everest | Height & Facts"),
      ResearchLink(url: URL(string: "https://en.wikipedia.org/wiki/Mount_Everest")!, title: "Mount Everest 'Sagarmatha'"),
    ])
  }

  @Test func termsSkipStopWords() {
    #expect(ResearchDigest.terms("What is the best espresso grinder in 2026?") == ["espresso", "grinder", "2026"])
  }

  @Test func excerptKeepsTheMostRelevantParagraphsInPageOrder() {
    let paragraphs = [
      "Welcome to our coffee blog where we talk about many different things every week.",
      "Cookies help us deliver our services and by using them you agree to the policy here.",
      "The best espresso grinder this year is the one with stepless burr adjustment and low retention.",
      "A good espresso grinder costs more than the machine, which surprises most new home baristas.",
    ]
    let excerpt = ResearchDigest.excerpt(paragraphs, query: "best espresso grinder", characterBudget: 200)
    #expect(excerpt == paragraphs[2] + "\n" + paragraphs[3])
    #expect(!excerpt.contains("Cookies"))
    #expect(excerpt.count <= 201)
  }

  @Test func promptNumbersEverySourceAndStaysInBudget() {
    let sources = (1...3).map { index in
      ResearchSource(id: index, url: URL(string: "https://s\(index).com")!, title: "Page \(index)", siteName: "S\(index)",
                     paragraphs: Array(repeating: "Espresso grinders differ in burr size, speed and how much coffee they keep inside.", count: 40))
    }
    let prompt = ResearchDigest.prompt(query: "espresso grinder", sources: sources, characterBudget: 3000)
    #expect(prompt.contains("[1] Page 1 (S1)"))
    #expect(prompt.contains("[3] Page 3 (S3)"))
    #expect(prompt.count < 3400)
  }

  @Test func extractiveAnswerCitesItsSources() {
    let sources = [
      ResearchSource(id: 1, url: URL(string: "https://a.com")!, title: "A", siteName: "A", paragraphs: [
        "Mount Everest is 8,849 metres tall according to the 2020 survey. It sits on the border of Nepal and China.",
      ]),
      ResearchSource(id: 2, url: URL(string: "https://b.com")!, title: "B", siteName: "B", paragraphs: [
        "Climbers usually reach the summit of Everest in May, when the jet stream moves north.",
      ]),
    ]
    let answer = ResearchDigest.extractiveAnswer(query: "how tall is mount everest", sources: sources)
    let lines = answer.split(separator: "\n")
    #expect(lines.first == "- Mount Everest is 8,849 metres tall according to the 2020 survey. [1]")
    #expect(lines.allSatisfy { $0.hasPrefix("- ") && $0.hasSuffix("]") })
  }

  @Test func answerBlocksReadHeadingsBulletsAndParagraphs() {
    let answer = "**Everest is 8,849 m tall** [1].\n\n## Height\n- Measured in 2020 [1, 2]\n* - Grows 4 mm a year [2]\nSafety tips:\n"
    #expect(ResearchAnswer.blocks(answer) == [
      .paragraph("Everest is 8,849 m tall [1]."),
      .heading("Height"),
      .bullet("Measured in 2020 [1, 2]"),
      .bullet("Grows 4 mm a year [2]"),
      .heading("Safety tips"),
    ])
    #expect(ResearchAnswer.citations(in: answer) == [1, 2])
  }

  @Test func adjacentCitationsFormOneRun() {
    let runs = ResearchAnswer.citationRuns(in: "Tall [2][3, 5]. Old [4].")
    #expect(runs.map(\.numbers) == [[2, 3, 5], [4]])
  }

  @Test func spokenAnswerDropsCitationsAndMarkup() {
    let answer = "Everest is 8,849 m tall [1].\n## Height\n- Measured in 2020 [1, 2]"
    #expect(ResearchAnswer.spoken(answer) == "Everest is 8,849 m tall.\nHeight.\nMeasured in 2020.")
  }

  @Test func proximityScriptReadsTimesAndStates() throws {
    let script = try #require(ProximityScript("6:far, 2:near ,9:1,bogus,10:sideways"))
    #expect(script.steps == [.init(after: 2, isNear: true), .init(after: 6, isNear: false), .init(after: 9, isNear: true)])
    #expect(ProximityScript("") == nil)
    #expect(ProximityScript("x:near") == nil)
  }

  @Test func holdingToTheEarBeforeTheAnswerStartsItWhenReady() {
    var listening = EarListening()
    #expect(listening.proximity(isNear: true) == .none)
    #expect(listening.answerReady() == .start(.earpiece))
    #expect(listening.state == .playing(.earpiece))
  }

  @Test func loweringThePhonePausesAndRaisingItResumes() {
    var listening = EarListening()
    _ = listening.answerReady()
    #expect(listening.proximity(isNear: true) == .start(.earpiece))
    #expect(listening.proximity(isNear: true) == .none)
    #expect(listening.proximity(isNear: false) == .pause)
    #expect(listening.state == .paused(.earpiece))
    #expect(listening.proximity(isNear: true) == .resume(.earpiece))
    listening.finished()
    #expect(listening.proximity(isNear: false) == .none)
    #expect(listening.proximity(isNear: true) == .start(.earpiece))
  }

  @Test func speakerPlaybackSurvivesLoweringAndMovesToTheEar() {
    var listening = EarListening()
    #expect(listening.toggleSpeaker() == .none)
    _ = listening.answerReady()
    #expect(listening.toggleSpeaker() == .start(.speaker))
    #expect(listening.proximity(isNear: false) == .none)
    #expect(listening.proximity(isNear: true) == .reroute(.earpiece))
    #expect(listening.toggleSpeaker() == .reroute(.speaker))
    #expect(listening.toggleSpeaker() == .pause)
    #expect(listening.toggleSpeaker() == .resume(.speaker))
  }
}

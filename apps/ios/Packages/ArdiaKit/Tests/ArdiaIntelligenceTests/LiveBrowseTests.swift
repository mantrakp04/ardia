import Foundation
import Testing

@testable import ArdiaIntelligence

let liveQuery = ProcessInfo.processInfo.environment["ARDIA_LIVE_INTELLIGENCE"]

@MainActor
struct LiveBrowseTests {
  @Test(.enabled(if: liveQuery != nil, "Set ARDIA_LIVE_INTELLIGENCE to a search to run Browse for Me against the web and the on-device model"))
  func `a real Browse for Me run`() async throws {
    let model = FoundationIntelligenceModel()
    try #require(model.status == .available)
    BrowseForMe.prewarm(model)
    let browse = BrowseForMe(query: try #require(liveQuery), model: model)

    await browse.run()

    print(LiveReport.render(browse))
    #expect(browse.phase == .done)
    #expect(!browse.page.sections.isEmpty)
  }
}

@MainActor
enum LiveReport {
  static func render(_ browse: BrowseForMe) -> String {
    func seconds(_ duration: Duration?) -> String {
      guard let duration else { return "n/a" }
      return (Double(duration.components.attoseconds) / 1e18 + Double(duration.components.seconds)).formatted(.number.precision(.fractionLength(2))) + " s"
    }
    var lines = [
      "PHASE \(browse.phase)",
      "TIMING search \(seconds(browse.timing.search)), title \(seconds(browse.timing.title)), answer \(seconds(browse.timing.answer)), reading \(seconds(browse.timing.reading)), sections start \(seconds(browse.timing.sectionsStart)), first section \(seconds(browse.timing.firstSection)), total \(seconds(browse.timing.total)), attempts \(browse.timing.attempts)",
      "SOURCES",
    ]
    lines += browse.sources.map { "  #\($0.id) \($0.state) \($0.siteName) \($0.result.url.absoluteString)" }
    let page = browse.page
    lines += ["TITLE \(page.title)", "ANSWER \(page.answer)", "HERO \(page.heroImageURL?.absoluteString ?? "none")"]
    for section in page.sections {
      lines.append("## \(section.heading)")
      lines += section.bullets.map { "  - \($0.emoji) [\($0.lead)] \($0.text) \($0.citations)" }
    }
    lines.append("FOLLOW-UPS \(page.followUps)")
    lines += page.sources.map { "  [\($0.number)] \($0.siteName): \($0.title)" }
    return lines.joined(separator: "\n")
  }
}

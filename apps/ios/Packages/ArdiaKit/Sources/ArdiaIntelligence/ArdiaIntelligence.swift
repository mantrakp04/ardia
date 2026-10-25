import Foundation
import Observation

@MainActor
@Observable
public final class Intelligence {
  public let availability: IntelligenceAvailability
  public let model: any IntelligenceModel
  public let sourcing: any BrowseSourcing

  @ObservationIgnored private var browses: [UUID: BrowseForMe] = [:]
  @ObservationIgnored private var summarizers: [UUID: PageSummarizer] = [:]
  @ObservationIgnored private var lastBrowsePrewarm: ContinuousClock.Instant?
  @ObservationIgnored private var lastSummaryPrewarm: ContinuousClock.Instant?
  private static let prewarmInterval: Duration = .seconds(45)

  public init(model: any IntelligenceModel = FoundationIntelligenceModel(), sourcing: any BrowseSourcing = WebSourcing()) {
    self.model = model
    self.sourcing = sourcing
    availability = IntelligenceAvailability(model: model)
    availability.startWatching()
  }

  public func browse(_ query: String, configuration: BrowseForMe.Configuration = .standard) -> BrowseForMe {
    BrowseForMe(query: query, model: model, sourcing: sourcing, configuration: configuration)
  }

  public func reopen(_ page: BrowsePage) -> BrowseForMe {
    BrowseForMe(restoring: page, model: model, sourcing: sourcing)
  }

  public func summarizer(for page: PageText) -> PageSummarizer {
    PageSummarizer(page: page, model: model)
  }

  public static func demo(status: IntelligenceStatus = .available, sourcing: DemoSourcing = DemoSourcing()) -> Intelligence {
    Intelligence(model: DemoIntelligenceModel(status: status), sourcing: sourcing)
  }

  public func browse(forTab tabID: UUID, query: String, restoring page: BrowsePage? = nil) -> BrowseForMe {
    if let existing = browses[tabID] { return existing }
    let created = page.map(reopen) ?? browse(query)
    browses[tabID] = created
    return created
  }

  public func existingBrowse(forTab tabID: UUID) -> BrowseForMe? {
    browses[tabID]
  }

  public func summarizer(forTab tabID: UUID, page: PageText) -> PageSummarizer {
    if let existing = summarizers[tabID], existing.page.url == page.url { return existing }
    summarizers[tabID]?.cancel()
    let created = summarizer(for: page)
    summarizers[tabID] = created
    return created
  }

  public func existingSummarizer(forTab tabID: UUID) -> PageSummarizer? {
    summarizers[tabID]
  }

  public func forget(tab tabID: UUID) {
    browses.removeValue(forKey: tabID)?.cancel()
    summarizers.removeValue(forKey: tabID)?.cancel()
  }

  public func searchFieldDidBeginEditing() {
    guard Self.isDue(&lastBrowsePrewarm) else { return }
    BrowseForMe.prewarm(model)
  }

  public func summaryWillOpen() {
    guard Self.isDue(&lastSummaryPrewarm), model.status.isAvailable else { return }
    model.prewarm(instructions: Prompts.summaryInstructions)
  }

  private static func isDue(_ last: inout ContinuousClock.Instant?) -> Bool {
    let now = ContinuousClock.now
    if let last, last.duration(to: now) < prewarmInterval { return false }
    last = now
    return true
  }
}

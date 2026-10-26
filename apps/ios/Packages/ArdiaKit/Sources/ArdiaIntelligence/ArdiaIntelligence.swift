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

  @ObservationIgnored private let featureSwitch: FeatureSwitch

  public var isEnabled: Bool {
    get { featureSwitch.isOn }
    set {
      guard newValue != featureSwitch.isOn else { return }
      featureSwitch.isOn = newValue
      if newValue {
        availability.refresh()
        availability.startWatching()
      } else {
        availability.stopWatching()
        browses.values.forEach { $0.cancel() }
        summarizers.values.forEach { $0.cancel() }
      }
    }
  }

  public init(
    model: any IntelligenceModel = FoundationIntelligenceModel(), sourcing: any BrowseSourcing = WebSourcing(),
    isEnabled: Bool = false
  ) {
    self.model = model
    self.sourcing = sourcing
    featureSwitch = FeatureSwitch(isOn: isEnabled)
    availability = IntelligenceAvailability(model: model)
    if isEnabled { availability.startWatching() }
  }

  public func browse(_ query: String, configuration: BrowseForMe.Configuration = .standard) -> BrowseForMe {
    BrowseForMe(query: query, model: model, sourcing: sourcing, configuration: configuration, gate: gate)
  }

  public func reopen(_ page: BrowsePage) -> BrowseForMe {
    BrowseForMe(restoring: page, model: model, sourcing: sourcing, gate: gate)
  }

  public func summarizer(for page: PageText) -> PageSummarizer {
    PageSummarizer(page: page, model: model, gate: gate)
  }

  private var gate: @MainActor () -> Bool {
    { [featureSwitch] in featureSwitch.isOn }
  }

  public static func demo(
    status: IntelligenceStatus = .available, sourcing: DemoSourcing = DemoSourcing(), isEnabled: Bool = true
  ) -> Intelligence {
    Intelligence(model: DemoIntelligenceModel(status: status), sourcing: sourcing, isEnabled: isEnabled)
  }

  public static func demo(arguments: [String]) -> Intelligence {
    let scenario = arguments.firstIndex(of: "-BrowseForMeDemo").flatMap { index in
      arguments.indices.contains(index + 1) ? arguments[index + 1] : nil
    }
    let status: IntelligenceStatus =
      switch scenario {
      case "appleIntelligenceOff": .appleIntelligenceOff
      case "deviceNotEligible": .deviceNotEligible
      case "modelDownloading": .modelDownloading
      default: .available
      }
    let outcome: DemoSourcing.Outcome =
      switch scenario {
      case "offline": .offline
      case "noResults": .noResults
      default: .works
      }
    return Intelligence(
      model: DemoIntelligenceModel(status: status, failsWriting: scenario == "writingFails"),
      sourcing: DemoSourcing(outcome, slowdown: scenario == "slow" ? 4 : 1), isEnabled: true)
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
    guard isEnabled, Self.isDue(&lastBrowsePrewarm) else { return }
    BrowseForMe.prewarm(model)
  }

  public func summaryWillOpen() {
    guard isEnabled, Self.isDue(&lastSummaryPrewarm), model.status.isAvailable else { return }
    model.prewarm(instructions: Prompts.summaryInstructions)
  }

  private static func isDue(_ last: inout ContinuousClock.Instant?) -> Bool {
    let now = ContinuousClock.now
    if let last, last.duration(to: now) < prewarmInterval { return false }
    last = now
    return true
  }
}

@MainActor
@Observable
final class FeatureSwitch {
  var isOn: Bool

  init(isOn: Bool) {
    self.isOn = isOn
  }
}

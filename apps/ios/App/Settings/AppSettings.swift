import Foundation
import Observation

@MainActor
@Observable
final class AppSettings {
  private enum Key {
    static let collapsesBottomBar = "settings.collapseBottomBar"
    static let autoOpensKeyboard = "settings.autoOpenKeyboard"
    static let finishedOnboarding = "settings.finishedOnboarding"
    static let aiFeatures = "settings.experiments.aiFeatures"
    static let browseForMe = "settings.experiments.browseForMe"
    static let pinchToSummarize = "settings.experiments.pinchToSummarize"
    static let askAboutPage = "settings.experiments.askAboutPage"
  }

  static let demoSuite = "ardia.demo.settings"

  @ObservationIgnored private let defaults: UserDefaults

  var collapsesBottomBar: Bool {
    didSet { defaults.set(collapsesBottomBar, forKey: Key.collapsesBottomBar) }
  }

  var autoOpensKeyboard: Bool {
    didSet { defaults.set(autoOpensKeyboard, forKey: Key.autoOpensKeyboard) }
  }

  var hasFinishedOnboarding: Bool {
    didSet { defaults.set(hasFinishedOnboarding, forKey: Key.finishedOnboarding) }
  }

  var aiFeaturesEnabled: Bool {
    didSet { defaults.set(aiFeaturesEnabled, forKey: Key.aiFeatures) }
  }

  var browseForMeEnabled: Bool {
    didSet { defaults.set(browseForMeEnabled, forKey: Key.browseForMe) }
  }

  var pinchToSummarizeEnabled: Bool {
    didSet { defaults.set(pinchToSummarizeEnabled, forKey: Key.pinchToSummarize) }
  }

  var askAboutPageEnabled: Bool {
    didSet { defaults.set(askAboutPageEnabled, forKey: Key.askAboutPage) }
  }

  var isShowingOnboarding = false
  var pendingRoute: SettingsRoute?

  var isBrowseForMeOn: Bool { aiFeaturesEnabled && browseForMeEnabled }
  var isPinchToSummarizeOn: Bool { aiFeaturesEnabled && pinchToSummarizeEnabled }
  var isAskAboutPageOn: Bool { aiFeaturesEnabled && askAboutPageEnabled }
  var pinchToSummarize: Bool { isPinchToSummarizeOn }

  init(defaults: UserDefaults, finishedOnboarding: Bool? = nil, aiFeatures: Bool? = nil) {
    self.defaults = defaults
    collapsesBottomBar = defaults.object(forKey: Key.collapsesBottomBar) as? Bool ?? false
    autoOpensKeyboard = defaults.object(forKey: Key.autoOpensKeyboard) as? Bool ?? true
    hasFinishedOnboarding = finishedOnboarding ?? defaults.bool(forKey: Key.finishedOnboarding)
    aiFeaturesEnabled = aiFeatures ?? defaults.bool(forKey: Key.aiFeatures)
    browseForMeEnabled = defaults.object(forKey: Key.browseForMe) as? Bool ?? true
    pinchToSummarizeEnabled = defaults.object(forKey: Key.pinchToSummarize) as? Bool ?? true
    askAboutPageEnabled = defaults.object(forKey: Key.askAboutPage) as? Bool ?? true
    isShowingOnboarding = !hasFinishedOnboarding
  }

  static func launch() -> AppSettings {
    let arguments = ProcessInfo.processInfo.arguments
    let isDemo = arguments.contains("-ArdiaDemo") || UserDefaults.standard.bool(forKey: "ArdiaDemo")
    guard isDemo, let demo = UserDefaults(suiteName: demoSuite) else { return AppSettings(defaults: .standard) }
    demo.removePersistentDomain(forName: demoSuite)
    let settings = AppSettings(
      defaults: demo,
      finishedOnboarding: !arguments.contains("-ArdiaOnboarding"),
      aiFeatures: arguments.contains("-ArdiaAIFeatures")
    )
    if arguments.contains("-ArdiaRestingStart") { settings.autoOpensKeyboard = false }
    return settings
  }

  func finishOnboarding() {
    hasFinishedOnboarding = true
    isShowingOnboarding = false
  }

  func showOnboarding() {
    isShowingOnboarding = true
  }
}

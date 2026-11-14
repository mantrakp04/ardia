import ArdiaDesign
import Foundation
import Observation

@MainActor
@Observable
final class AppSettings {
  private enum Key {
    static let collapsesBottomBar = "settings.collapseBottomBar"
    static let autoOpensKeyboard = "settings.autoOpenKeyboard"
    static let finishedOnboarding = "settings.finishedOnboarding"
    static let colorChoice = "settings.color"
    static let interfaceStyle = "settings.interfaceStyle"
    static let schemeChoice = "settings.schemeChoice"
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

  var colorChoice: String? {
    didSet { defaults.set(colorChoice, forKey: Key.colorChoice) }
  }

  var interfaceStyle: InterfaceStyle {
    didSet { defaults.set(interfaceStyle.rawValue, forKey: Key.interfaceStyle) }
  }

  var schemeChoice: SchemeChoice {
    didSet { defaults.set(schemeChoice.rawValue, forKey: Key.schemeChoice) }
  }

  var isShowingOnboarding = false
  var pendingRoute: SettingsRoute?

  init(defaults: UserDefaults, finishedOnboarding: Bool? = nil) {
    self.defaults = defaults
    collapsesBottomBar = defaults.object(forKey: Key.collapsesBottomBar) as? Bool ?? false
    autoOpensKeyboard = defaults.object(forKey: Key.autoOpensKeyboard) as? Bool ?? true
    hasFinishedOnboarding = finishedOnboarding ?? defaults.bool(forKey: Key.finishedOnboarding)
    colorChoice = defaults.string(forKey: Key.colorChoice)
    interfaceStyle = defaults.string(forKey: Key.interfaceStyle).flatMap(InterfaceStyle.init(rawValue:)) ?? .matchMac
    schemeChoice = defaults.string(forKey: Key.schemeChoice).flatMap(SchemeChoice.init(rawValue:)) ?? .matchMac
    isShowingOnboarding = !hasFinishedOnboarding
  }

  static func launch() -> AppSettings {
    let arguments = ProcessInfo.processInfo.arguments
    let isDemo = arguments.contains("-ArdiaDemo") || UserDefaults.standard.bool(forKey: "ArdiaDemo")
    guard isDemo, let demo = UserDefaults(suiteName: demoSuite) else { return AppSettings(defaults: .standard) }
    demo.removePersistentDomain(forName: demoSuite)
    let settings = AppSettings(
      defaults: demo,
      finishedOnboarding: !arguments.contains("-ArdiaOnboarding")
    )
    if arguments.contains("-ArdiaRestingStart") { settings.autoOpensKeyboard = false }
    if let index = arguments.firstIndex(of: "-ArdiaColor"), arguments.indices.contains(index + 1) {
      settings.colorChoice = arguments[index + 1]
    }
    if let index = arguments.firstIndex(of: "-ArdiaInterfaceStyle"), arguments.indices.contains(index + 1) {
      settings.interfaceStyle = InterfaceStyle(rawValue: arguments[index + 1]) ?? .matchMac
    }
    if let index = arguments.firstIndex(of: "-ArdiaColorScheme"), arguments.indices.contains(index + 1) {
      settings.schemeChoice = SchemeChoice(rawValue: arguments[index + 1]) ?? .matchMac
    }
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

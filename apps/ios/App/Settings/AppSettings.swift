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
    static let colorScheme = "settings.colorScheme"
    static let showsSidebarAtEdge = "settings.sidebarAtScreenEdge"
    static let collapseDefaultSettled = "settings.collapseBottomBarDefaultSettled"
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

  var interfaceStyleChoice: InterfaceStyleChoice {
    didSet { defaults.set(interfaceStyleChoice.rawValue, forKey: Key.interfaceStyle) }
  }

  var colorSchemeChoice: ColorSchemeChoice {
    didSet { defaults.set(colorSchemeChoice.rawValue, forKey: Key.colorScheme) }
  }

  var showsSidebarAtEdge: Bool {
    didSet { defaults.set(showsSidebarAtEdge, forKey: Key.showsSidebarAtEdge) }
  }

  var appearanceChoices: AppearanceChoices {
    AppearanceChoices(interfaceStyle: interfaceStyleChoice, colorScheme: colorSchemeChoice)
  }

  var isShowingOnboarding = false
  var pendingRoute: SettingsRoute?

  init(defaults: UserDefaults, finishedOnboarding: Bool? = nil) {
    self.defaults = defaults
    NewInstallDefault(
      setting: Key.collapsesBottomBar,
      marker: Key.collapseDefaultSettled,
      evidence: [Key.finishedOnboarding, Key.autoOpensKeyboard, Key.colorChoice]
    ).settle(in: defaults)
    collapsesBottomBar = defaults.object(forKey: Key.collapsesBottomBar) as? Bool ?? true
    autoOpensKeyboard = defaults.object(forKey: Key.autoOpensKeyboard) as? Bool ?? true
    hasFinishedOnboarding = finishedOnboarding ?? defaults.bool(forKey: Key.finishedOnboarding)
    colorChoice = defaults.string(forKey: Key.colorChoice)
    interfaceStyleChoice = defaults.string(forKey: Key.interfaceStyle).flatMap(InterfaceStyleChoice.init(rawValue:)) ?? .matchMac
    colorSchemeChoice = defaults.string(forKey: Key.colorScheme).flatMap(ColorSchemeChoice.init(rawValue:)) ?? .matchMac
    showsSidebarAtEdge = defaults.object(forKey: Key.showsSidebarAtEdge) as? Bool ?? true
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
    func argument(_ key: String) -> String? {
      guard let index = arguments.firstIndex(of: key), arguments.indices.contains(index + 1) else { return nil }
      return arguments[index + 1]
    }
    if let color = argument("-ArdiaColor") { settings.colorChoice = color }
    if let style = argument("-ArdiaInterfaceStyle").flatMap(InterfaceStyleChoice.init(argument:)) { settings.interfaceStyleChoice = style }
    if let scheme = argument("-ArdiaColorScheme").flatMap(ColorSchemeChoice.init(argument:)) { settings.colorSchemeChoice = scheme }
    if let edge = argument("-ArdiaSidebarEdge"), edge == "off" || edge == "on" { settings.showsSidebarAtEdge = edge == "on" }
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

extension InterfaceStyleChoice {
  init?(argument: String) {
    self.init(rawValue: argument == "mac" ? Self.matchMac.rawValue : argument)
  }
}

extension ColorSchemeChoice {
  init?(argument: String) {
    self.init(rawValue: argument == "mac" ? Self.matchMac.rawValue : argument)
  }
}

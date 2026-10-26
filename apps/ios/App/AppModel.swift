import ArdiaBrowser
import ArdiaIntelligence
import ArdiaSync
import Foundation
import Observation
import SwiftData

@MainActor
@Observable
final class AppModel {
  enum Surface: Equatable {
    case search
    case browsing
    case tabSwitcher
  }

  enum Sheet: String, Identifiable {
    case settings
    case syncSetup
    case onboarding
    case archive
    case syncedSpaces

    var id: String { rawValue }
  }

  let isDemo: Bool
  let container: ModelContainer
  let tabs: TabStore
  let blocking: BlockingSettings
  let blocker: ContentBlocker
  let web: WebEngine
  let sync: SyncService
  let preferences: BrowsingPreferences
  let intelligence: Intelligence
  let omnibox: Omnibox
  let browse = BrowseSession()
  let toasts = ToastCenter()
  let settings = AppSettings.launch()
  let deck: TabDeckModel

  var surface: Surface = .search
  var sheet: Sheet?
  var isIncognito = false

  init(isDemo: Bool) {
    self.isDemo = isDemo
    let defaults = isDemo ? (UserDefaults(suiteName: "ardia.demo") ?? .standard) : .standard
    if isDemo { defaults.removePersistentDomain(forName: "ardia.demo") }
    let container: ModelContainer
    do {
      container = try BrowserStore.makeContainer(isDemo ? .inMemory : .appGroup)
    } catch {
      container = try! BrowserStore.makeContainer(.inMemory)
    }
    self.container = container
    tabs = TabStore(context: container.mainContext, defaults: defaults)
    blocking = BlockingSettings(defaults: defaults)
    blocker = ContentBlocker(
      settings: blocking,
      directory: URL.cachesDirectory.appending(path: "Blocking", directoryHint: .isDirectory),
      filterLists: isDemo ? .demo(directory: URL.temporaryDirectory.appending(path: "ArdiaDemoFilters", directoryHint: .isDirectory), defaults: defaults) : nil
    )
    preferences = BrowsingPreferences(defaults: defaults)
    web = WebEngine(tabs: tabs, blocker: blocker, preferences: preferences)
    deck = TabDeckModel(defaults: defaults)
    sync = isDemo ? .demo : SyncService()
    intelligence = isDemo ? .demo(arguments: ProcessInfo.processInfo.arguments) : Intelligence()
    omnibox = Omnibox()
    connectServices()
  }

  static func launch() -> AppModel {
    AppModel(isDemo: ProcessInfo.processInfo.arguments.contains("-ArdiaDemo") || UserDefaults.standard.bool(forKey: "ArdiaDemo"))
  }
}

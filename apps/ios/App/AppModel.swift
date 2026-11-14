import ArdiaBrowser
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

  enum Sheet: Hashable, Identifiable {
    case settings
    case syncSetup
    case onboarding
    case archive
    case syncedSpaces
    case library(LibrarySection)

    var id: Self { self }
  }

  let isDemo: Bool
  let container: ModelContainer
  let usesFallbackStore: Bool
  let tabs: TabStore
  let blocking: BlockingSettings
  let blocker: ContentBlocker
  let web: WebEngine
  let sync: SyncService
  let preferences: BrowsingPreferences
  let omnibox: Omnibox
  let browse = BrowseSession()
  let toasts = ToastCenter()
  let settings = AppSettings.launch()
  let deck: TabDeckModel
  let defaultBrowser: DefaultBrowserStatus

  var surface: Surface = .search
  var sheet: Sheet?
  var isIncognito = false
  @ObservationIgnored var inboxInFlight: Set<UUID> = []
  @ObservationIgnored var inboxSent: Set<UUID> = []

  init(isDemo: Bool) {
    self.isDemo = isDemo
    let defaults = isDemo ? (UserDefaults(suiteName: "ardia.demo") ?? .standard) : .standard
    if isDemo { defaults.removePersistentDomain(forName: "ardia.demo") }
    let store = Self.openBrowserStore(isDemo: isDemo)
    let container = store.container
    usesFallbackStore = store.isFallback
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
    defaultBrowser = DefaultBrowserStatus(defaults: defaults, asksSystem: !isDemo)
    sync = isDemo ? .demo : SyncService()
    omnibox = Omnibox()
    connectServices()
    connectSpaces()
  }

  static func launch() -> AppModel {
    AppModel(isDemo: ProcessInfo.processInfo.arguments.contains("-ArdiaDemo") || UserDefaults.standard.bool(forKey: "ArdiaDemo"))
  }
}

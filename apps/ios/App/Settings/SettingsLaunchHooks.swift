import ArdiaBrowser
import SwiftUI

extension View {
  func launchHooks() -> some View {
    modifier(SettingsLaunchHooks())
  }
}

private struct SettingsLaunchHooks: ViewModifier {
  @Environment(AppModel.self) private var app

  func body(content: Content) -> some View {
    #if DEBUG
    content.task {
      let arguments = ProcessInfo.processInfo.arguments
      if let index = arguments.firstIndex(of: "-ArdiaFilterState"), arguments.indices.contains(index + 1) {
        app.filterLists.seedDemo(states: FilterStateSample.states(arguments[index + 1], lists: app.filterLists.enabledLists.map(\.id)))
      }
      if arguments.contains("-ArdiaTrustedSites") {
        for host in ["nytimes.com", "theverge.com", "bbc.co.uk"] { app.blocking.setExempt(host, true) }
      }
      if arguments.contains("-ArdiaMyFiltersSample") {
        _ = await app.filterLists.applyMyFilters(MyFiltersSample.text)
      }
      if arguments.contains("-ArdiaSettingsPage") || arguments.contains("-ArdiaOpenSettings") {
        try? await Task.sleep(for: .milliseconds(600))
        app.sheet = .settings
      }
      if let index = arguments.firstIndex(of: "-ArdiaOpenSheet"), arguments.indices.contains(index + 1) {
        try? await Task.sleep(for: .milliseconds(600))
        switch arguments[index + 1] {
        case "archive": app.openArchive()
        case "spaces": app.openSyncedSpaces()
        default: break
        }
      }
      if let index = arguments.firstIndex(of: "-ArdiaToast"), arguments.indices.contains(index + 1) {
        try? await Task.sleep(for: .seconds(1.5))
        switch arguments[index + 1] {
        case "copied": app.toasts.show(.copiedURL)
        case "cleared": app.toasts.show(.clearedBrowsingData)
        case "received": app.toasts.show(.tabReceived(from: "MacBook Pro"))
        case "receivedSeveral": app.toasts.show(.tabReceived(from: "MacBook Pro", count: 3))
        default: break
        }
      }
    }
    #else
    content
    #endif
  }
}

#if DEBUG
enum FilterStateSample {
  static func states(_ name: String, lists: [String]) -> [String: FilterListState] {
    switch name {
    case "downloading":
      return Dictionary(uniqueKeysWithValues: lists.prefix(3).map { ($0, FilterListState.downloading) })
    case "compiling":
      return Dictionary(uniqueKeysWithValues: lists.prefix(3).map { ($0, FilterListState.compiling) })
    case "offline":
      return Dictionary(uniqueKeysWithValues: lists.map { ($0, FilterListState.offline) })
    case "failed":
      return ["ublock-filters": .failed(String(localized: "The server didn’t respond. Ardia will try again in a few minutes."))]
    default:
      return [:]
    }
  }
}

enum MyFiltersSample {
  static let text = """
    ! Newsletter pop-ups
    example.com##.newsletter-modal
    ||ads.example.net^
    ||tracker.example.org^$third-party
    news.example.com##+js(set-constant, adBlockDetected, false)
    """
}
#endif

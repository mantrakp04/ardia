import ArdiaBrowser
import Foundation
import SwiftData
import UIKit

@MainActor
final class PhonePages {
  static let shared = PhonePages()

  let engine: WebEngine
  private let container: ModelContainer
  private var tabIDs: [String: UUID] = [:]

  private init() {
    let defaults = UserDefaults(suiteName: "ardia.phone.pages") ?? .standard
    container = (try? BrowserStore.makeContainer(.inMemory)) ?? (try! BrowserStore.makeContainer(.inMemory))
    let tabs = TabStore(context: container.mainContext, defaults: defaults)
    let blocker = ContentBlocker(
      settings: BlockingSettings(defaults: defaults),
      directory: URL.cachesDirectory.appending(path: "Blocking", directoryHint: .isDirectory)
    )
    engine = WebEngine(tabs: tabs, blocker: blocker, preferences: BrowsingPreferences(defaults: defaults))
    engine.openExternalURL = { url in UIApplication.shared.open(url) }
    Task { await blocker.prepare() }
  }

  func open(_ pageID: String, initialURL: String?) -> WebTab? {
    let tabID: UUID
    if let existing = tabIDs[pageID], engine.tabs.tab(existing)?.isArchived == false {
      tabID = existing
    } else {
      let url = initialURL.flatMap(URL.init(string:)) ?? URL(string: "about:blank")!
      tabID = engine.tabs.open(.url(url, origin: .typed)).id
      tabIDs[pageID] = tabID
    }
    engine.tabs.select(tabID)
    let page = engine.webTab(for: tabID)
    page?.makeLive()
    return page
  }

  func close(_ pageID: String) {
    guard let tabID = tabIDs.removeValue(forKey: pageID) else { return }
    engine.existingWebTab(tabID)?.discard()
    engine.tabs.close(tabID)
  }
}

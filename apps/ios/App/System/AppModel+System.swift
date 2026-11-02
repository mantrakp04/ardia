import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import Foundation

extension AppModel {
  var systemStore: SystemStore? {
    isDemo ? SystemStore(directory: URL.temporaryDirectory.appending(path: "ArdiaDemoSystem", directoryHint: .isDirectory)) : SystemStore.shared
  }

  func handle(_ link: SystemLink) {
    switch link {
    case .search(let query):
      prepareForSystemEntry()
      if let query {
        openSearch(query)
      } else {
        showSearch()
      }
    case .voiceSearch:
      prepareForSystemEntry()
      showSearch()
      browse.isVoicePresented = true
    case .incognito:
      prepareForSystemEntry()
      newIncognitoTab()
      browse.presentSearch(from: .home)
    case .open(let url):
      openWebLink(url, origin: .link)
    case .tab(let id):
      openTabFromSystem(id)
    case .macTabs:
      prepareForSystemEntry()
      sheet = sync.isEnabled ? .syncedSpaces : .syncSetup
    case .inbox:
      drainSystemInbox()
    }
  }

  func openWebLink(_ url: URL, origin: TabOrigin) {
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
    prepareForSystemEntry()
    isIncognito = false
    openPage(url, origin: origin)
  }

  @discardableResult
  func openTabFromSystem(_ id: UUID) -> Bool {
    guard let tab = tabs.tab(id), !tab.isPrivate else { return false }
    prepareForSystemEntry()
    if tab.isArchived {
      restoreArchived(id)
    } else {
      openTab(id)
    }
    return true
  }

  func showSearch() {
    browse.isToolbarPresented = false
    surface = .search
    browse.presentSearch(from: .home)
  }

  private func prepareForSystemEntry() {
    sheet = nil
    browse.isVoicePresented = false
    browse.isToolbarPresented = false
    browse.readerTabID = nil
  }

  func drainSystemInbox() {
    guard !isDemo, let store = systemStore else { return }
    for item in store.drainInbox() {
      receive(item)
    }
  }

  private func receive(_ item: SystemInboxItem) {
    let url = item.url.flatMap(URL.init(string:))
    switch item.action {
    case .open:
      if let url { openWebLink(url, origin: .share) }
    case .send(let target):
      guard let url else { return }
      sendFromShareSheet(url: url, title: item.title, to: target)
    }
  }

  private func sendFromShareSheet(url: URL, title: String, to target: SystemDevice) {
    guard sync.isEnabled, let device = sync.snapshot.devices.first(where: { $0.id == target.id }) else {
      toasts.show(Toast(String(localized: "Couldn’t Send to \(target.name)"), symbol: "exclamationmark.triangle.fill"))
      return
    }
    Task {
      if await sync.send(url: url, title: title, to: device) {
        toasts.show(.sentTab(to: device.name))
      } else {
        toasts.show(Toast(String(localized: "Couldn’t Send to \(device.name)"), symbol: "exclamationmark.triangle.fill"))
      }
    }
  }
}

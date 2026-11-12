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

  func drainSystemInbox(sendsOnly: Bool = false) {
    guard !isDemo, let store = systemStore else { return }
    for item in store.pendingInbox() where !inboxInFlight.contains(item.id) {
      if sendsOnly, case .open = item.action { continue }
      if inboxSent.contains(item.id) {
        store.removeFromInbox(item.id)
        continue
      }
      let url = item.url.flatMap(URL.init(string:))
      switch item.action {
      case .open:
        store.removeFromInbox(item.id)
        if let url { openWebLink(url, origin: .share) }
      case .send(let target):
        guard let url else {
          store.removeFromInbox(item.id)
          continue
        }
        inboxInFlight.insert(item.id)
        Task {
          await sendFromShareSheet(item.id, url: url, title: item.title, to: target, store: store)
          inboxInFlight.remove(item.id)
        }
      }
    }
  }

  private func sendFromShareSheet(_ id: UUID, url: URL, title: String, to target: SystemDevice, store: SystemStore) async {
    let deadline = ContinuousClock.now + Self.inboxSyncWait
    while !syncCanAnswer(for: target), ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(250))
    }
    guard syncCanAnswer(for: target) else { return }
    guard sync.isEnabled, let device = sync.snapshot.devices.first(where: { $0.id == target.id }) else {
      store.removeFromInbox(id)
      toasts.show(Toast(String(localized: "Couldn’t Send to \(target.name)"), symbol: "exclamationmark.triangle.fill"))
      return
    }
    if await sync.send(url: url, title: title, to: device, key: id) {
      inboxSent.insert(id)
      store.removeFromInbox(id)
      toasts.show(.sentTab(to: device.name))
    } else {
      toasts.show(Toast(String(localized: "Couldn’t Send to \(device.name)"), symbol: "exclamationmark.triangle.fill"))
    }
  }

  static let inboxSyncWait: Duration = .seconds(20)

  private func syncCanAnswer(for target: SystemDevice) -> Bool {
    !sync.isEnabled || sync.phase == .updated || sync.snapshot.devices.contains { $0.id == target.id }
  }
}

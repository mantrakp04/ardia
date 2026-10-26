import ArdiaBrowser
import ArdiaSync
import Foundation
import SwiftData
import UIKit

extension AppModel {
  var deckTabs: [BrowserTab] {
    tabs.openTabs + tabs.privateTabs
  }

  var hasArchivedTabs: Bool {
    let descriptor = FetchDescriptor<BrowserTab>(predicate: #Predicate { $0.archivedAt != nil })
    return ((try? tabs.context.fetchCount(descriptor)) ?? 0) > 0
  }

  var deckOrder: [BrowserTab] {
    Self.recencyOrder(deckTabs, selected: tabs.selectedTabID)
  }

  static func recencyOrder(_ tabs: [BrowserTab], selected: UUID?) -> [BrowserTab] {
    tabs.sorted { lhs, rhs in
      if lhs.id == selected { return false }
      if rhs.id == selected { return true }
      if lhs.lastActive != rhs.lastActive { return lhs.lastActive < rhs.lastActive }
      return lhs.position < rhs.position
    }
  }

  func showTabSwitcher() {
    captureHandoff()
    if let id = tabs.selectedTabID, deck.handoff?.tabID == id {
      deck.entrance = .fromPage(id)
    } else {
      deck.entrance = .plain
    }
    surface = .tabSwitcher
  }

  func captureHandoff() {
    deck.handoff = nil
    guard let id = tabs.selectedTabID, surface == .browsing else { return }
    if let page = web.existingWebTab(id), let webView = page.webView, webView.window != nil, !webView.bounds.isEmpty {
      let image = Self.render(webView, cropBottom: 0)
      deck.handoff = TabDeckModel.Handoff(tabID: id, image: image)
      persistSnapshot(image, for: id)
    } else if let window = Self.keyWindow() {
      let image = Self.render(window, cropBottom: window.safeAreaInsets.bottom + Self.browsingBarClearance)
      deck.handoff = TabDeckModel.Handoff(tabID: id, image: image)
      persistSnapshot(image, for: id)
    }
  }

  static let browsingBarClearance: CGFloat = 52

  private func persistSnapshot(_ image: UIImage, for id: UUID) {
    guard let cgImage = image.cgImage else { return }
    if tabs.isPrivate(id) {
      tabs.update(id, snapshotFileName: web.snapshots.keepInMemory(cgImage, for: id))
      return
    }
    let scale = image.scale
    Task {
      if let name = await web.snapshots.save(cgImage, scale: scale, for: id) {
        tabs.update(id, snapshotFileName: name)
      }
    }
  }

  private static func render(_ view: UIView, cropBottom: CGFloat) -> UIImage {
    let bounds = view.bounds
    let rect = CGRect(x: 0, y: 0, width: bounds.width, height: max(bounds.height - cropBottom, 1))
    let format = UIGraphicsImageRendererFormat.preferred()
    format.opaque = true
    return UIGraphicsImageRenderer(bounds: rect, format: format).image { _ in
      _ = view.drawHierarchy(in: bounds, afterScreenUpdates: false)
    }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
  }

  func prepareToOpen(_ id: UUID) {
    _ = web.webTab(for: id)
  }

  func primeCover(for id: UUID) async {
    guard browse.covers.image(for: id) == nil else { return }
    if let memory = deck.memoryImage(for: id) {
      browse.covers.store(memory, for: id)
    } else if let name = tabs.tab(id)?.snapshotFileName, let image = await web.snapshots.image(named: name) {
      browse.covers.store(UIImage(cgImage: image), for: id)
    }
  }

  func beginOpening(_ id: UUID) {
    guard tabs.tab(id) != nil, tabs.selectedTabID != id else { return }
    isIncognito = tabs.isPrivate(id)
    tabs.select(id)
    _ = web.webTab(for: id)
  }

  func openTab(_ id: UUID) {
    isIncognito = tabs.isPrivate(id)
    tabs.select(id)
    _ = web.webTab(for: id)
    surface = .browsing
  }

  func newTab() {
    surface = .search
  }

  func newRegularTab() {
    isIncognito = false
    surface = .search
  }

  func newIncognitoTab() {
    isIncognito = true
    surface = .search
  }

  func leaveIncognito() {
    deck.forget(Set(tabs.privateTabs.map(\.id)))
    tabs.closeAllPrivate()
    isIncognito = false
  }

  func closeTab(_ id: UUID) {
    deck.forget([id])
    browse.covers.forget(id)
    browse.tones[id] = nil
    tabs.close(id)
  }

  func closeAllTabs() {
    deck.forget(Set(deckTabs.map(\.id)))
    tabs.closeAllPrivate()
    tabs.closeAll()
    isIncognito = false
  }

  func reopenLastClosed() {
    let reopened = tabs.reopenLastClosed()
    if let last = reopened.last { openTab(last.id) }
  }

  func openArchive() {
    sheet = .archive
  }

  func openSyncedSpaces() {
    sheet = .syncedSpaces
  }

  func openRemote(url: String, title: String, profileSyncId: String?) {
    guard let target = URL(string: url) else { return }
    if isIncognito { isIncognito = false }
    if let profileSyncId, sync.isEnabled, profileSyncId != tabs.profileSyncId {
      switchProfile(to: profileSyncId)
    }
    if let existing = tabs.openTabs.first(where: { $0.url == url }) {
      sheet = nil
      openTab(existing.id)
      return
    }
    let tab = tabs.open(.url(target, origin: .sync))
    if !title.isEmpty { tabs.update(tab.id, title: title) }
    sheet = nil
    openTab(tab.id)
  }

  func switchProfile(to syncId: String) {
    sync.selectedProfileId = syncId
    tabs.profileSyncId = syncId
  }

  func restoreArchived(_ id: UUID) {
    tabs.restore(id)
    sheet = nil
    openTab(id)
  }

  func copyLink(of tab: BrowserTab) {
    guard let url = URL(string: tab.url) else { return }
    web.copyLink(url)
    toasts.show(.copiedURLWithoutTrackers)
  }

  func shareURL(of tab: BrowserTab) -> URL? {
    URL(string: tab.url).flatMap { BrowserURL.isSyncable($0.absoluteString) ? $0 : nil }
  }

  func send(_ tab: BrowserTab, to device: SyncedDevice) {
    guard let url = URL(string: tab.url) else { return }
    let title = tab.title
    let profile = tab.profileSyncId
    Task {
      if await sync.send(url: url, title: title, to: device, profileSyncId: profile) {
        toasts.show(.sentTab(to: device.name))
      } else {
        toasts.show(Toast(String(localized: "Couldn’t Send to \(device.name)"), symbol: "exclamationmark.triangle.fill"))
      }
    }
  }

  func pinToMac(_ tab: BrowserTab) {
    guard let url = URL(string: tab.url) else { return }
    let title = tab.title
    let profile = tab.profileSyncId
    Task {
      if await sync.addBookmark(url: url, title: title, profileSyncId: profile) {
        toasts.show(Toast(String(localized: "Pinned to Your Mac"), symbol: "star.fill"))
      } else {
        toasts.show(Toast(String(localized: "Couldn’t Pin to Your Mac"), symbol: "exclamationmark.triangle.fill"))
      }
    }
  }

  var canSendTabs: Bool {
    sync.isEnabled && !sync.devicesThatReceiveTabs.isEmpty
  }
}

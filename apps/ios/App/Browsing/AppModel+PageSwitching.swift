import ArdiaBrowser
import Foundation
import UIKit

extension AppModel {
  var swipeOrder: [BrowserTab] {
    let current = deckOrder
    guard let frozen = browse.frozenOrder else { return current }
    let byID = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })
    let kept = frozen.compactMap { byID[$0] }
    let added = current.filter { !frozen.contains($0.id) }
    return kept + added
  }

  func rememberCurrentCover() {
    guard let id = tabs.selectedTabID, let page = web.existingWebTab(id), !page.isLoading, page.failure == nil,
          let webView = page.webView, let image = PageCoverCache.capture(webView) else { return }
    browse.covers.store(image, for: id)
  }

  func saveCurrentSnapshot() {
    rememberCurrentCover()
    guard let id = tabs.selectedTabID, let image = browse.covers.image(for: id), let cgImage = image.cgImage else { return }
    let snapshots = web.snapshots
    let tabs = tabs
    if tabs.isPrivate(id) {
      tabs.update(id, snapshotFileName: snapshots.keepInMemory(cgImage, for: id))
      return
    }
    let scale = image.scale
    Task {
      if let name = await snapshots.save(cgImage, scale: scale, for: id) {
        tabs.update(id, snapshotFileName: name)
      }
    }
  }

  func openDeckFromPage() {
    browse.thawOrder()
    saveCurrentSnapshot()
    showTabSwitcher()
  }

  func switchTab(to id: UUID, order: [BrowserTab]) {
    rememberCurrentCover()
    browse.freezeOrder(order.map(\.id))
    openTab(id)
  }

  func stepTab(_ delta: Int) {
    let order = swipeOrder
    guard let index = order.firstIndex(where: { $0.id == tabs.selectedTabID }), order.indices.contains(index + delta) else { return }
    switchTab(to: order[index + delta].id, order: order)
  }

  func closeCurrentTab() {
    guard let id = tabs.selectedTabID else { return }
    closeTab(id)
  }
}

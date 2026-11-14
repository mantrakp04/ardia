import Foundation

@MainActor
public protocol DiscardablePage: AnyObject {
  var isLive: Bool { get }
  func makeLive()
  func discard()
}

@MainActor
final class LivePageRoster<Page: DiscardablePage> {
  let limit: Int
  private(set) var recency: [UUID] = []
  private var pages: [UUID: Page] = [:]

  init(limit: Int) {
    self.limit = max(1, limit)
  }

  var liveIDs: [UUID] { recency.filter { pages[$0]?.isLive == true } }

  func page(_ id: UUID) -> Page? { pages[id] }

  func register(_ page: Page, for id: UUID) {
    pages[id] = page
  }

  func activate(_ id: UUID) {
    guard let page = pages[id] else { return }
    recency.removeAll { $0 == id }
    recency.append(id)
    if !page.isLive { page.makeLive() }
    trim(keeping: id)
  }

  func remove(_ id: UUID) {
    recency.removeAll { $0 == id }
    if let page = pages.removeValue(forKey: id), page.isLive { page.discard() }
  }

  func discardAll(except kept: UUID?) {
    for id in recency where id != kept {
      if let page = pages[id], page.isLive { page.discard() }
    }
    recency = (kept.map { [$0] } ?? []).filter { pages[$0]?.isLive == true }
  }

  private func trim(keeping kept: UUID) {
    var live = liveIDs
    while live.count > limit, let oldest = live.first(where: { $0 != kept }) {
      pages[oldest]?.discard()
      recency.removeAll { $0 == oldest }
      live.removeAll { $0 == oldest }
    }
  }
}

import ArdiaSync
import Foundation

extension TabStore {
  public func move(_ id: UUID, to index: Int) {
    if let from = privateTabs.firstIndex(where: { $0.id == id }) {
      let tab = privateTabs.remove(at: from)
      privateTabs.insert(tab, at: max(0, min(index, privateTabs.count)))
      for (offset, each) in privateTabs.enumerated() { each.position = Double(offset) * TabPositions.step }
      return
    }
    guard let tab = allOpenTabs.first(where: { $0.id == id }) else { return }
    var siblings = spaceSiblings(of: tab)
    guard let from = siblings.firstIndex(where: { $0.id == id }), siblings.count > 1 else { return }
    siblings.remove(at: from)
    let target = max(0, min(index, siblings.count))
    guard target != from else { return }
    let lower = target > 0 ? siblings[target - 1] : nil
    let upper = target < siblings.count ? siblings[target] : nil
    openers[id] = nil
    if let position = TabPositions.between(lower?.position, upper?.position) {
      tab.position = position
    } else {
      var order = allOpenTabs.filter { $0.id != id }
      let at = upper.flatMap { upper in order.firstIndex { $0.id == upper.id } } ?? lower.flatMap { lower in order.firstIndex { $0.id == lower.id }.map { $0 + 1 } } ?? order.count
      order.insert(tab, at: at)
      renumber(order)
    }
    allOpenTabs.sort { $0.position < $1.position }
    persist(changedTabs: false)
  }

  func position(for placement: TabPlacement, profileSyncId: String?, background: Bool) -> Double {
    guard case .after(let openerID) = placement, let opener = allOpenTabs.first(where: { $0.id == openerID }) else { return endPosition() }
    let siblings = allOpenTabs.filter { spaceRoster.space(of: $0.profileSyncId) == spaceRoster.space(of: profileSyncId) }
    guard let openerIndex = siblings.firstIndex(where: { $0.id == opener.id }) else { return endPosition() }
    let index = background ? afterFamily(in: siblings, from: openerIndex + 1, opener: opener.id) : openerIndex + 1
    let lower = siblings[index - 1]
    let upper = index < siblings.count ? siblings[index] : nil
    if let between = TabPositions.between(lower.position, upper?.position) { return between }
    renumber(allOpenTabs)
    return lower.position + TabPositions.step / 2
  }

  func endPosition() -> Double {
    (allOpenTabs.last?.position).map { $0 + TabPositions.step } ?? 0
  }

  func insertSorted(_ tab: BrowserTab) {
    var tabs = allOpenTabs.filter { $0.id != tab.id }
    let index = tabs.firstIndex { $0.position > tab.position } ?? tabs.count
    tabs.insert(tab, at: index)
    allOpenTabs = tabs
  }

  func keepOrForgetOpeners(from: UUID, to: UUID) {
    let fromOpener = openers[from]
    let toOpener = openers[to]
    let related = fromOpener == toOpener || toOpener == from || fromOpener == to
    guard !related else { return }
    openers = toOpener.map { [to: $0] } ?? [:]
  }

  private func afterFamily(in siblings: [BrowserTab], from start: Int, opener: UUID) -> Int {
    var family: Set<UUID> = [opener]
    var index = start
    while index < siblings.count, let parent = openers[siblings[index].id], family.contains(parent) {
      family.insert(siblings[index].id)
      index += 1
    }
    return index
  }

  private func spaceSiblings(of tab: BrowserTab) -> [BrowserTab] {
    let space = spaceRoster.space(of: tab.profileSyncId)
    return allOpenTabs.filter { spaceRoster.space(of: $0.profileSyncId) == space }
  }

  private func renumber(_ order: [BrowserTab]) {
    for (offset, each) in order.enumerated() { each.position = Double(offset) * TabPositions.step }
  }
}

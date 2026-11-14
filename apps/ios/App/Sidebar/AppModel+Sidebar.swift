import ArdiaBrowser
import ArdiaDesign
import Foundation

extension AppModel {
  var sidebarOrder: [BrowserTab] {
    spaceTabs + tabs.privateTabs
  }

  func editCurrentAddress() {
    guard surface == .browsing, let tab = tabs.selectedTab else {
      newTab()
      return
    }
    browse.presentSearch(from: .page, text: currentQuery(for: tab), selectsAll: true)
  }

  func open(_ destination: SidebarDrop.Destination, at index: Int? = nil) {
    if index != nil { isIncognito = false }
    switch destination {
    case .page(let url): openPage(url, origin: .typed)
    case .search(let query): openSearch(query)
    }
    guard let index, let id = tabs.selectedTabID, !tabs.isPrivate(id) else { return }
    moveTab(id, toIndex: index)
  }

  func stepSidebarTab(_ delta: Int) {
    let order = sidebarOrder
    let current = order.firstIndex { $0.id == tabs.selectedTabID }
    guard let index = TabStep.index(from: current, by: delta, count: order.count) else { return }
    openTab(order[index].id)
  }

  func selectSidebarTab(_ command: BrowserCommand) {
    let order = sidebarOrder
    guard let index = command.tabIndex(count: order.count) else { return }
    openTab(order[index].id)
  }

  func syncSurfaceForSidebar() {
    switch surface {
    case .tabSwitcher: surface = tabs.selectedTab == nil ? .search : .browsing
    case .browsing where tabs.selectedTab == nil: surface = .search
    case .search where tabs.selectedTab != nil && browse.search == nil: surface = .browsing
    default: break
    }
  }
}

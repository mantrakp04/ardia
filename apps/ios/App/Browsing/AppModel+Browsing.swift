import ArdiaBrowser
import ArdiaSync
import Foundation
import UIKit
import WebKit

extension AppModel {
  var currentPage: WebTab? {
    guard let id = tabs.selectedTabID, let tab = tabs.tab(id), tab.origin != .browseForMe else { return nil }
    return web.existingWebTab(id)
  }

  @discardableResult
  func copyCurrentLink() -> Bool {
    guard let tab = tabs.selectedTab, let url = URL(string: tab.url), BrowserURL.isSyncable(tab.url) else { return false }
    web.copyLink(url)
    browse.showTitleFeedback(String(localized: "Copied URL"))
    return true
  }

  func shareCurrentPage() {
    guard let tab = tabs.selectedTab, let url = URL(string: tab.url), BrowserURL.isSyncable(tab.url) else { return }
    web.share(url)
  }

  func pinCurrentToMac() {
    guard let tab = tabs.selectedTab else { return }
    guard sync.isEnabled else {
      toasts.show(Toast(String(localized: "Sync With Your Mac to Pin Tabs"), symbol: "laptopcomputer") { [weak self] in
        self?.sheet = .syncSetup
      })
      return
    }
    pinToMac(tab)
  }

  func setNightShade(_ on: Bool, for page: WebTab) {
    guard let host = page.host else { return }
    preferences.update(host) { $0.nightShade = on ? .always : .disabled }
  }

  func toggleDesktopSite(for page: WebTab) {
    guard let webView = page.webView else { return }
    let wantsDesktop = !browse.desktopTabs.contains(page.id)
    if wantsDesktop {
      browse.desktopTabs.insert(page.id)
      webView.customUserAgent = Self.desktopUserAgent
    } else {
      browse.desktopTabs.remove(page.id)
      webView.customUserAgent = nil
    }
    page.reload()
  }

  static let desktopUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"

  func translate(_ page: WebTab) {
    guard let url = page.url, var components = URLComponents(string: "https://translate.google.com/translate") else { return }
    let language = Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "en"
    components.queryItems = [
      URLQueryItem(name: "sl", value: "auto"),
      URLQueryItem(name: "tl", value: language),
      URLQueryItem(name: "u", value: url.absoluteString),
    ]
    if let target = components.url { page.load(target) }
  }

  func toggleBlockers(for page: WebTab) {
    if let message = page.setBlockersEnabled(!page.blockersEnabled) {
      toasts.show(Toast(message, symbol: page.blockersEnabled ? "hand.raised.fill" : "hand.raised.slash"))
    }
  }

  func openInDefaultBrowser(_ page: WebTab) {
    guard let url = page.url else { return }
    UIApplication.shared.open(url)
  }

  var isDefaultBrowser: Bool {
    (try? UIApplication.shared.isDefault(.webBrowser)) ?? false
  }

  func goBackToSearchIfEmpty() {
    if tabs.selectedTab == nil, surface == .browsing { surface = .search }
  }
}

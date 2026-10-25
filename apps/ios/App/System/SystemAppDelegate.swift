import ArdiaDesign
import Observation
import UIKit

@MainActor
@Observable
final class SystemEvents {
  static let shared = SystemEvents()

  private(set) var pending: [SystemLink] = []

  func post(_ link: SystemLink) {
    pending.append(link)
  }

  func takeAll() -> [SystemLink] {
    defer { pending.removeAll() }
    return pending
  }
}

enum QuickAction: String, CaseIterable {
  case search = "com.ardia.ios.search"
  case voiceSearch = "com.ardia.ios.voice"
  case incognito = "com.ardia.ios.incognito"
  case browseForMe = "com.ardia.ios.browse-for-me"

  var link: SystemLink {
    switch self {
    case .search: .search(query: nil, browseForMe: false)
    case .voiceSearch: .voiceSearch
    case .incognito: .incognito
    case .browseForMe: .search(query: nil, browseForMe: true)
    }
  }

  var item: UIApplicationShortcutItem {
    UIApplicationShortcutItem(type: rawValue, localizedTitle: title, localizedSubtitle: nil, icon: UIApplicationShortcutIcon(systemImageName: symbol))
  }

  private var title: String {
    switch self {
    case .search: String(localized: "Search")
    case .voiceSearch: String(localized: "Voice Search")
    case .incognito: String(localized: "New Incognito Tab")
    case .browseForMe: String(localized: "Browse for Me")
    }
  }

  private var symbol: String {
    switch self {
    case .search: "magnifyingglass"
    case .voiceSearch: "mic"
    case .incognito: "eyes"
    case .browseForMe: "sparkle.magnifyingglass"
    }
  }

  static func items(browseForMe: Bool) -> [UIApplicationShortcutItem] {
    let actions: [QuickAction] = browseForMe ? [.search, .browseForMe, .voiceSearch, .incognito] : [.search, .voiceSearch, .incognito]
    return actions.map(\.item)
  }
}

final class SystemAppDelegate: NSObject, UIApplicationDelegate {
  func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
    configuration.delegateClass = SystemSceneDelegate.self
    return configuration
  }
}

final class SystemSceneDelegate: NSObject, UIWindowSceneDelegate {
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    if let item = connectionOptions.shortcutItem, let action = QuickAction(rawValue: item.type) {
      SystemEvents.shared.post(action.link)
    }
  }

  func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
    guard let action = QuickAction(rawValue: shortcutItem.type) else { return false }
    SystemEvents.shared.post(action.link)
    return true
  }
}

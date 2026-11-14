import SwiftUI

enum SettingsRoute: String, Hashable {
  case appearance
  case sync
  case siteSettings
  case connect
  case searchEngine
  case filterLists
  case filterListDetail
  case myFilters
  case trustedSites
  case clearData
  case defaultBrowser
  case about
  case licenses

  @MainActor @ViewBuilder
  var destination: some View {
    switch self {
    case .appearance: AppearancePage()
    case .sync: SyncSettingsPage()
    case .siteSettings: SiteSettingsPage()
    case .connect: SyncConnectPage()
    case .searchEngine: SearchEnginePage()
    case .filterLists: FilterListsPage()
    case .filterListDetail: FilterListDetailPage(listID: "ublock-filters")
    case .myFilters: MyFiltersEditor()
    case .trustedSites: TrustedSitesPage()
    case .clearData: ClearBrowsingDataPage()
    case .defaultBrowser: DefaultBrowserPage()
    case .about: AboutPage()
    case .licenses: LicensesPage()
    }
  }

  static let bottomAnchor = "settings.bottom"

  static var launchScrollAnchor: UnitPoint? {
    #if DEBUG
    ProcessInfo.processInfo.arguments.contains("-ArdiaSettingsBottom") ? .bottom : nil
    #else
    nil
    #endif
  }

  static var launchRoute: SettingsRoute? {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "-ArdiaSettingsPage"), arguments.indices.contains(index + 1) else { return nil }
    return SettingsRoute(rawValue: arguments[index + 1])
  }
}

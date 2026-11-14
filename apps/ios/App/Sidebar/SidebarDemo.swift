import ArdiaDesign
import Foundation

struct SidebarDemo: Equatable {
  let isDemo: Bool
  let showsSidebar: Bool?
  let width: CGFloat?
  let hoveredRow: Int?
  let commandBarText: String?
  let playsToggleScript: Bool
  let peekKind: SidebarPeekKind?
  let delay: Double

  static let current = SidebarDemo(arguments: ProcessInfo.processInfo.arguments)
  static let defaultDelay: Double = 6
  static let scriptToggles = 4
  static let scriptGap: Double = 1.4

  init(arguments: [String]) {
    func value(_ key: String) -> String? {
      guard let index = arguments.firstIndex(of: key), arguments.indices.contains(index + 1) else { return nil }
      return arguments[index + 1]
    }
    isDemo = arguments.contains("-ArdiaDemo") || UserDefaults.standard.bool(forKey: "ArdiaDemo")
    showsSidebar = value("-ArdiaSidebar").flatMap { word in
      switch word {
      case "shown", "open": true
      case "hidden": false
      default: nil
      }
    }
    width = value("-ArdiaSidebarWidth").flatMap(Double.init).map { CGFloat($0) }
    hoveredRow = value("-ArdiaSidebarHover").flatMap(Int.init)
    commandBarText = value("-ArdiaCommandBar")
    playsToggleScript = arguments.contains("-ArdiaSidebarScript")
    peekKind = arguments.contains("-ArdiaSidebarPeek") ? (value("-ArdiaSidebarPeek") == "touch" ? .touch : .pointer) : nil
    delay = value("-BrowseDelay").flatMap(Double.init) ?? Self.defaultDelay
  }

  @MainActor
  func applyVisibility(to sidebar: SidebarState) {
    guard isDemo, let shows = showsSidebar ?? (peekKind == nil ? nil : false), sidebar.visibility != SidebarVisibility(shownEverywhere: shows) else { return }
    sidebar.showEverywhere(shows)
  }

  @MainActor
  func apply(app: AppModel, sidebar: SidebarState, context: SidebarContext) async {
    guard isDemo else { return }
    if let width { sidebar.commitWidth(width) }
    guard hoveredRow != nil || commandBarText != nil || playsToggleScript || peekKind != nil else { return }
    try? await Task.sleep(for: .seconds(delay))
    if let peekKind, SidebarPeek.allowsPeek(placement: sidebar.placement(layout: context.layout, hinge: context.hinge), isEnabled: app.settings.showsSidebarAtEdge) {
      sidebar.peek(peekKind, layout: context.layout, hinge: context.hinge)
    }
    if playsToggleScript {
      for _ in 0..<Self.scriptToggles {
        sidebar.toggle(layout: context.layout, hinge: context.hinge)
        try? await Task.sleep(for: .seconds(Self.scriptGap))
      }
    }
    if let hoveredRow {
      let order = app.sidebarOrder
      sidebar.demoHoveredTab = order.indices.contains(hoveredRow) ? order[hoveredRow].id : nil
    }
    if let commandBarText {
      app.browse.presentSearch(from: .page, text: commandBarText)
    }
  }
}

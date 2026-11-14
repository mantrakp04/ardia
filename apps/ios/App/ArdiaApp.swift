import ArdiaDesign
import ArdiaSync
import SwiftData
import SwiftUI

@main
struct ArdiaApp: App {
  @UIApplicationDelegateAdaptor(SystemAppDelegate.self) private var systemDelegate
  @State private var model: AppModel
  @State private var sidebar: SidebarState

  init() {
    SyncService.registerBackgroundRefresh()
    let launched = AppModel.launch()
    _model = State(initialValue: launched)
    _sidebar = State(initialValue: SidebarState.launch(isDemo: launched.isDemo))
    SystemIntegration.register(launched)
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .background { AlternateShortcuts(commands: BrowserCommand.allCases.filter { $0 != .toggleSidebar }, context: nil) }
        .modifier(CommandFrontPublisher())
        .environment(model)
        .environment(sidebar)
        .modelContainer(model.container)
        .systemIntegrations(model)
    }
    .commands {
      BrowserCommands(app: model, sidebar: sidebar)
    }
  }
}

import AppIntents

struct SwitchToTabIntent: AppIntent {
  static let title: LocalizedStringResource = "Switch to Tab"
  static let description = IntentDescription("Shows a tab, with its window in front and its profile on screen.")
  static let openAppWhenRun = true

  @Parameter(title: "Tab") var tab: TabEntity

  static var parameterSummary: some ParameterSummary { Summary("Switch to \(\.$tab)") }

  @MainActor
  func perform() async throws -> some IntentResult {
    try await IntentBridge.ready()
    _ = try await IntentBridge.run(["command": "focusTab", "tabId": try IntentBridge.tab(tab.id).id])
    return .result()
  }
}

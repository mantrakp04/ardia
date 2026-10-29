import AppIntents

struct CloseTabsIntent: AppIntent {
  static let title: LocalizedStringResource = "Close Tabs"
  static let description = IntentDescription("Closes the tabs you pass it, such as the ones Get Open Tabs found. If one of them is already closed, it closes none and says so.")

  @Parameter(title: "Tabs") var tabs: [TabEntity]

  static var parameterSummary: some ParameterSummary { Summary("Close \(\.$tabs)") }

  @MainActor
  func perform() async throws -> some IntentResult {
    _ = try await IntentBridge.run(["command": "closeTabs", "tabIds": tabs.map(\.id)])
    return .result()
  }
}

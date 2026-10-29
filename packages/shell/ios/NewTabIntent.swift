import AppIntents

struct NewTabIntent: AppIntent {
  static let title: LocalizedStringResource = "New Tab in Profile"
  static let description = IntentDescription("Opens a new tab in a profile, in the window links from other apps would use, or a new window.")
  static let openAppWhenRun = true

  @Parameter(title: "Profile") var profile: ProfileEntity

  static var parameterSummary: some ParameterSummary { Summary("New tab in \(\.$profile)") }

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<TabEntity> {
    let opened = try await IntentBridge.run(["command": "newTabInProfile", "profileId": profile.id])
    guard let tabId = opened["tabId"] as? String, !tabId.isEmpty else { throw IntentError.noTab }
    return .result(value: TabEntity(tab: try IntentBridge.tab(tabId)))
  }
}

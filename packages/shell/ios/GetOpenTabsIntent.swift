import AppIntents

struct GetOpenTabsIntent: AppIntent {
  static let title: LocalizedStringResource = "Get Open Tabs"
  static let description = IntentDescription("Lists Ardia's open tabs, front window first. Private windows' tabs are left out.")

  @Parameter(title: "Profile") var profile: ProfileEntity?

  static var parameterSummary: some ParameterSummary { Summary("Get open tabs") { \.$profile } }

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<[TabEntity]> {
    try await IntentBridge.ready()
    return .result(value: TabEntity.open.filter { profile == nil || $0.profile.id == profile?.id })
  }
}

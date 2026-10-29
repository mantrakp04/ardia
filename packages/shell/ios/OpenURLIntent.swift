import AppIntents

struct OpenURLIntent: AppIntent {
  static let title: LocalizedStringResource = "Open URL"
  static let description = IntentDescription("Opens a link in Ardia. Without a profile or destination it goes where links from other apps go.")
  static let openAppWhenRun = true

  @Parameter(title: "URL") var url: URL
  @Parameter(title: "Profile") var profile: ProfileEntity?
  @Parameter(title: "Open In") var destination: LinkDestination?

  static var parameterSummary: some ParameterSummary {
    Summary("Open \(\.$url)") {
      \.$profile
      \.$destination
    }
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    try await IntentBridge.ready()
    if let profile, !ShellScripting.state.profiles.contains(where: { $0.id == profile.id }) { throw IntentError.profileGone }
    OpenURLInbox.open(url, profileId: profile?.id, littleArdia: destination.map { $0 == .littleArdia })
    return .result()
  }
}

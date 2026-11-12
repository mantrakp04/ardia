import AppIntents

struct SearchControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Search"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    SystemEvents.shared.post(QuickAction.search.link)
    return .result()
  }
}

struct VoiceSearchControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Voice Search"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    SystemEvents.shared.post(QuickAction.voiceSearch.link)
    return .result()
  }
}

struct IncognitoControlIntent: AppIntent {
  static let title: LocalizedStringResource = "New Incognito Tab"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    SystemEvents.shared.post(QuickAction.incognito.link)
    return .result()
  }
}

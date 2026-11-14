import AppIntents
import ArdiaDesign
import ArdiaPhoneNative
import Foundation

struct SearchWithArdiaIntent: AppIntent {
  static let title: LocalizedStringResource = "Search with Ardia"
  static let description = IntentDescription("Searches the web in Ardia, or opens Ardia ready to type.")
  static let supportedModes: IntentModes = .foreground

  @Parameter(title: "Search", requestValueDialog: "What do you want to search for?")
  var query: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Search the web for \(\.$query)")
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    PhoneSystemLinks.shared.post(.search(query: query?.trimmingCharacters(in: .whitespacesAndNewlines)), source: "intent")
    return .result()
  }
}

struct VoiceSearchIntent: AppIntent {
  static let title: LocalizedStringResource = "Voice Search"
  static let description = IntentDescription("Opens Ardia and starts listening for your search.")
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    PhoneSystemLinks.shared.post(.voiceSearch, source: "intent")
    return .result()
  }
}

struct NewIncognitoTabIntent: AppIntent {
  static let title: LocalizedStringResource = "New Incognito Tab"
  static let description = IntentDescription("Opens a tab that isn’t saved to your history or synced.")
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    PhoneSystemLinks.shared.post(.incognito, source: "intent")
    return .result()
  }
}

struct OpenURLInArdiaIntent: AppIntent {
  static let title: LocalizedStringResource = "Open in Ardia"
  static let description = IntentDescription("Opens a web page in a new tab in Ardia.")
  static let supportedModes: IntentModes = .foreground

  @Parameter(title: "URL")
  var url: URL

  static var parameterSummary: some ParameterSummary {
    Summary("Open \(\.$url) in Ardia")
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
      throw IntentFailure.notWebPage
    }
    PhoneSystemLinks.shared.post(.open(url), source: "intent")
    return .result()
  }
}

struct OpenMacTabsIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Synced Tabs"
  static let description = IntentDescription("Shows the tabs, pinned tabs and Spaces synced from Ardia on your computer.")
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    PhoneSystemLinks.shared.post(.macTabs, source: "intent")
    return .result()
  }
}

struct SearchControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Search"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    PhoneSystemLinks.shared.post(.search(query: nil), source: "shortcut")
    return .result()
  }
}

struct VoiceSearchControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Voice Search"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    PhoneSystemLinks.shared.post(.voiceSearch, source: "shortcut")
    return .result()
  }
}

struct IncognitoControlIntent: AppIntent {
  static let title: LocalizedStringResource = "New Incognito Tab"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground

  @MainActor
  func perform() async throws -> some IntentResult {
    PhoneSystemLinks.shared.post(.incognito, source: "shortcut")
    return .result()
  }
}

enum IntentFailure: Error, CustomLocalizedStringResourceConvertible {
  case notWebPage

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .notWebPage: "Ardia opens web pages that start with http or https."
    }
  }
}

struct ArdiaShortcuts: AppShortcutsProvider {
  static let shortcutTileColor: ShortcutTileColor = .navy

  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SearchWithArdiaIntent(),
      phrases: [
        "Search with \(.applicationName)",
        "Start a Search with \(.applicationName)",
        "Search the web with \(.applicationName)",
      ],
      shortTitle: "Search",
      systemImageName: "magnifyingglass"
    )
    AppShortcut(
      intent: VoiceSearchIntent(),
      phrases: [
        "Voice Search with \(.applicationName)",
        "Start a Voice Search with \(.applicationName)",
      ],
      shortTitle: "Voice Search",
      systemImageName: "waveform.badge.magnifyingglass"
    )
    AppShortcut(
      intent: OpenMacTabsIntent(),
      phrases: [
        "Show my synced tabs in \(.applicationName)",
        "Open my synced tabs in \(.applicationName)",
      ],
      shortTitle: "Synced Tabs",
      systemImageName: "laptopcomputer"
    )
    AppShortcut(
      intent: NewIncognitoTabIntent(),
      phrases: [
        "Open an Incognito tab in \(.applicationName)",
        "New Incognito tab in \(.applicationName)",
      ],
      shortTitle: "Incognito Tab",
      systemImageName: "eyes"
    )
  }
}

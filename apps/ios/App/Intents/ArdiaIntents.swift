import AppIntents
import ArdiaBrowser
import ArdiaDesign
import Foundation

nonisolated enum IntentCopy {
  static let aiFeaturesOff: IntentDialog = "Turn on AI Features in Ardia’s Settings › Experiments."
}

struct SearchWithArdiaIntent: AppIntent {
  static let title: LocalizedStringResource = "Search with Ardia"
  static let description = IntentDescription("Searches the web in Ardia, or opens Ardia ready to type.")
  static let supportedModes: IntentModes = .foreground

  @Parameter(title: "Search", requestValueDialog: "What do you want to search for?")
  var query: String?

  @Parameter(title: "Browse for Me", default: false)
  var browseForMe: Bool

  static var parameterSummary: some ParameterSummary {
    Summary("Search the web for \(\.$query)") {
      \.$browseForMe
    }
  }

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult {
    let link = SystemLink.search(query: query?.trimmingCharacters(in: .whitespacesAndNewlines), browseForMe: browseForMe)
    app.handle(link)
    return .result()
  }
}

struct BrowseForMeIntent: AppIntent {
  static let title: LocalizedStringResource = "Browse for Me"
  static let description = IntentDescription("Reads the web for you and makes a page with the answer.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: "Question", requestValueDialog: "What should Ardia look up for you?")
  var query: String

  static var parameterSummary: some ParameterSummary {
    Summary("Browse for Me about \(\.$query)")
  }

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard app.isBrowseForMeAvailable else {
      return .result(dialog: IntentCopy.aiFeaturesOff)
    }
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw $query.needsValueError()
    }
    try await continueInForeground(alwaysConfirm: false)
    app.handle(.search(query: trimmed, browseForMe: true))
    return .result(dialog: "Browsing for you.")
  }
}

struct VoiceSearchIntent: AppIntent {
  static let title: LocalizedStringResource = "Voice Search"
  static let description = IntentDescription("Opens Ardia and starts listening for your search.")
  static let supportedModes: IntentModes = .foreground

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult {
    app.handle(.voiceSearch)
    return .result()
  }
}

struct NewIncognitoTabIntent: AppIntent {
  static let title: LocalizedStringResource = "New Incognito Tab"
  static let description = IntentDescription("Opens a tab that isn’t saved to your history or synced.")
  static let supportedModes: IntentModes = .foreground

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult {
    app.handle(.incognito)
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

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult {
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
      throw IntentFailure.notWebPage
    }
    let target = url
    app.openWebLink(target, origin: .link)
    return .result()
  }
}

@AppIntent(schema: .browser.switchTab)
struct OpenTabIntent: OpenIntent {
  static let title: LocalizedStringResource = "Open Tab"
  static let description = IntentDescription("Switches to one of your tabs in Ardia, or brings an archived tab back.")
  static let supportedModes: IntentModes = .foreground

  @Parameter(title: "Tab")
  var target: TabEntity

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult {
    let id = target.id
    guard app.openTabFromSystem(id) else {
      throw IntentFailure.tabGone
    }
    return .result()
  }
}

struct OpenMacTabsIntent: AppIntent {
  static let title: LocalizedStringResource = "Open My Mac’s Tabs"
  static let description = IntentDescription("Shows the tabs, pinned tabs and Spaces from Ardia on your Mac.")
  static let supportedModes: IntentModes = .foreground

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult {
    app.handle(.macTabs)
    return .result()
  }
}

struct SummarizePageIntent: AppIntent {
  static let title: LocalizedStringResource = "Summarize Page"
  static let description = IntentDescription("Summarizes the page you’re reading in Ardia.")
  static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Dependency var app: AppModel

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard app.isSummaryAvailable else {
      return .result(dialog: IntentCopy.aiFeaturesOff)
    }
    guard let tabID = app.summarizableTabID else {
      return .result(dialog: "Open a web page in Ardia, then try again.")
    }
    try await continueInForeground(alwaysConfirm: false)
    app.summarizeFromSystem(tabID)
    return .result(dialog: "Summarizing the page.")
  }
}

enum IntentFailure: Error, CustomLocalizedStringResourceConvertible {
  case tabGone
  case notWebPage

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .tabGone: "That tab isn’t open anymore."
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
        "Show my Mac’s tabs in \(.applicationName)",
        "Open my Mac’s tabs in \(.applicationName)",
      ],
      shortTitle: "My Mac’s Tabs",
      systemImageName: "laptopcomputer"
    )
    AppShortcut(
      intent: OpenTabIntent(),
      phrases: [
        "Open \(\.$target) in \(.applicationName)",
        "Switch to \(\.$target) in \(.applicationName)",
      ],
      shortTitle: "Open Tab",
      systemImageName: "square.on.square"
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

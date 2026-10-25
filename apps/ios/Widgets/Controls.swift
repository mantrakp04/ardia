import AppIntents
import ArdiaDesign
import SwiftUI
import WidgetKit

nonisolated protocol ArdiaLinkControlIntent: AppIntent {
  static var link: SystemLink { get }
}

nonisolated extension ArdiaLinkControlIntent {
  static var isDiscoverable: Bool { false }

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(Self.link.url))
  }
}

nonisolated struct SearchControlIntent: ArdiaLinkControlIntent {
  static let title: LocalizedStringResource = "Search"
  static let link = SystemLink.search(query: nil, browseForMe: false)
}

nonisolated struct VoiceSearchControlIntent: ArdiaLinkControlIntent {
  static let title: LocalizedStringResource = "Voice Search"
  static let link = SystemLink.voiceSearch
}

nonisolated struct IncognitoControlIntent: ArdiaLinkControlIntent {
  static let title: LocalizedStringResource = "New Incognito Tab"
  static let link = SystemLink.incognito
}

struct SearchControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.ardia.ios.control.search") {
      ControlWidgetButton(action: SearchControlIntent()) {
        Label("Search", systemImage: "magnifyingglass")
      }
    }
    .displayName("Search")
    .description("Start a search in Ardia.")
  }
}

struct VoiceSearchControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.ardia.ios.control.voice") {
      ControlWidgetButton(action: VoiceSearchControlIntent()) {
        Label("Voice Search", systemImage: "mic.fill")
      }
    }
    .displayName("Voice Search")
    .description("Search Ardia with your voice.")
  }
}

struct IncognitoTabControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "com.ardia.ios.control.incognito") {
      ControlWidgetButton(action: IncognitoControlIntent()) {
        Label("Incognito Tab", systemImage: "eyes")
      }
    }
    .displayName("New Incognito Tab")
    .description("Open a private tab in Ardia.")
  }
}

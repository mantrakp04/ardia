import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct ExperimentsPage: View {
  @Environment(AppModel.self) private var app
  @Environment(\.openURL) private var openURL
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    @Bindable var settings = app.settings
    let status = Self.launchStatus ?? app.intelligence.availability.status
    Form {
      SettingsHero(
        "Experiments",
        subtitle: Text("Early features that use Apple Intelligence on this iPhone, with nothing sent to a server."),
        systemImage: "flask.fill",
        tint: SettingsTint.experiments
      )

      Section {
        Toggle("AI Features", isOn: $settings.aiFeaturesEnabled)
      } footer: {
        if !settings.aiFeaturesEnabled {
          Text("Turn on to try Browse for Me, page summaries and questions about a page. You can turn each one off.")
        }
      }

      if settings.aiFeaturesEnabled {
        Section {
          Toggle(isOn: $settings.browseForMeEnabled) {
            SettingsRowLabel("Browse for Me", systemImage: "sparkle.magnifyingglass", tint: SettingsTint.search)
          }
          Toggle(isOn: $settings.pinchToSummarizeEnabled) {
            SettingsRowLabel("Pinch to Summarize", systemImage: "rectangle.compress.vertical", tint: SettingsTint.pinch)
          }
          Toggle(isOn: $settings.askAboutPageEnabled) {
            SettingsRowLabel("Ask About This Page", systemImage: "questionmark.bubble.fill", tint: SettingsTint.blue)
          }
        } header: {
          Text("Features")
        } footer: {
          Text(ExperimentsWords.featuresFooter(
            browse: settings.browseForMeEnabled,
            summarize: settings.pinchToSummarizeEnabled,
            ask: settings.askAboutPageEnabled
          ))
          .contentTransition(.opacity)
        }
        .transition(.opacity.combined(with: .move(edge: .top)))

        Section {
          LabeledContent {
            Text(IntelligenceWords.rowValue(status))
              .foregroundStyle(status.isAvailable ? AnyShapeStyle(.secondary) : AnyShapeStyle(.ink(.orange)))
          } label: {
            SettingsRowLabel("Apple Intelligence", systemImage: "apple.intelligence", tint: SettingsTint.intelligence)
          }
          if IntelligenceWords.canOpenSettings(status) {
            Button("Open Settings") {
              if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
          }
        } footer: {
          Text(IntelligenceWords.statusFooter(status))
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
    .settingsPage("Experiments")
    .animation(reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.28), value: settings.aiFeaturesEnabled)
    .onAppear { app.intelligence.availability.refresh() }
  }
}

extension ExperimentsPage {
  static var launchStatus: IntelligenceStatus? {
    #if DEBUG
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "-ArdiaIntelligenceStatus"), arguments.indices.contains(index + 1) else { return nil }
    switch arguments[index + 1] {
    case "off": return .appleIntelligenceOff
    case "ineligible": return .deviceNotEligible
    case "downloading": return .modelDownloading
    case "language": return .languageUnsupported
    default: return nil
    }
    #else
    nil
    #endif
  }
}

enum ExperimentsWords {
  static func featuresFooter(browse: Bool, summarize: Bool, ask: Bool) -> String {
    var lines: [String] = []
    if browse { lines.append(String(localized: "Browse for Me reads the top results and writes you one page with the answer.")) }
    if summarize { lines.append(String(localized: "Pinch in on a page, or tap Summarize, for its key points.")) }
    if !summarize { lines.append(String(localized: "With Pinch to Summarize off, pinching a page zooms it.")) }
    if ask { lines.append(String(localized: "Ask About This Page answers questions from the page you’re reading.")) }
    return lines.joined(separator: " ")
  }
}

enum IntelligenceWords {
  static func rowValue(_ status: IntelligenceStatus) -> String {
    switch status {
    case .available: String(localized: "Ready")
    case .appleIntelligenceOff: String(localized: "Off")
    case .modelDownloading: String(localized: "Getting Ready")
    case .deviceNotEligible, .languageUnsupported: String(localized: "Not Available")
    }
  }

  static func canOpenSettings(_ status: IntelligenceStatus) -> Bool {
    status == .appleIntelligenceOff || status == .languageUnsupported
  }

  static func statusFooter(_ status: IntelligenceStatus) -> String {
    switch status {
    case .available:
      String(localized: "These features run on this iPhone with Apple Intelligence. Your searches go to your search engine, and nothing else leaves your iPhone.")
    case .deviceNotEligible:
      String(localized: "This iPhone doesn’t support Apple Intelligence, so these features can’t run here. Browse for Me shows the top results instead.")
    case .appleIntelligenceOff:
      String(localized: "These features can’t run until Apple Intelligence is on. Turn it on in Settings, under Apple Intelligence & Siri.")
    case .modelDownloading:
      String(localized: "Apple Intelligence is still downloading. These features start working when it finishes.")
    case .languageUnsupported:
      String(localized: "Apple Intelligence doesn’t support your iPhone’s language yet, so these features can’t run. You can change it in Settings, under Apple Intelligence & Siri.")
    }
  }
}

#Preview("Experiments") {
  NavigationStack {
    ExperimentsPage()
  }
  .environment(AppModel(isDemo: true))
}

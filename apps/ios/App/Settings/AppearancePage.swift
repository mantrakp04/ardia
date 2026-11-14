import ArdiaDesign
import SwiftUI

struct AppearancePage: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    Form {
      Section {
        ColorChoiceRows()
      }

      Section {
        ForEach(InterfaceStyle.allCases, id: \.self) { style in
          CheckmarkRow(title: style.name, isChecked: app.settings.interfaceStyle == style) {
            app.settings.interfaceStyle = style
          }
        }
      } header: {
        Text("Interface Style")
      } footer: {
        Text("Match My Mac follows your Mac. Reduce Transparency in iOS Settings always uses Classic.")
      }

      Section {
        ForEach(SchemeChoice.allCases, id: \.self) { choice in
          CheckmarkRow(title: choice.name, isChecked: app.settings.schemeChoice == choice) {
            app.settings.schemeChoice = choice
          }
        }
      } header: {
        Text("Light or Dark")
      } footer: {
        Text("Match My Mac follows your Mac. System follows this device.")
      }
    }
    .contentMargins(.top, Spacing.small, for: .scrollContent)
    .navigationTitle("Appearance")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct CheckmarkRow: View {
  var title: String
  var isChecked: Bool
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack {
        Text(title)
          .foregroundStyle(.primary)
        Spacer()
        if isChecked {
          Image(systemName: "checkmark")
            .font(.body.weight(.semibold))
            .foregroundStyle(Palette.formAccent)
            .accessibilityHidden(true)
        }
      }
      .contentShape(.rect)
    }
    .tint(.primary)
    .accessibilityAddTraits(isChecked ? .isSelected : [])
  }
}

enum AppearanceSummary {
  @MainActor
  static func text(_ app: AppModel) -> String {
    var parts: [String] = []
    if let preset = app.settings.colorChoice.flatMap(ProfileLook.Preset.init(rawValue:)) { parts.append(preset.name) }
    if app.settings.interfaceStyle != .matchMac { parts.append(app.settings.interfaceStyle.name) }
    if app.settings.schemeChoice != .matchMac { parts.append(app.settings.schemeChoice.name) }
    return parts.isEmpty ? String(localized: "Match My Mac") : parts.formatted(.list(type: .and, width: .narrow))
  }
}

extension InterfaceStyle {
  var name: String {
    switch self {
    case .matchMac: String(localized: "Match My Mac")
    case .glass: String(localized: "Glass")
    case .classic: String(localized: "Classic")
    }
  }
}

extension SchemeChoice {
  var name: String {
    switch self {
    case .matchMac: String(localized: "Match My Mac")
    case .system: String(localized: "System")
    case .light: String(localized: "Light")
    case .dark: String(localized: "Dark")
    }
  }
}

extension ProfileLook.Preset {
  var name: String {
    switch self {
    case .plum: String(localized: "Plum")
    case .blue: String(localized: "Blue")
    case .purple: String(localized: "Purple")
    case .pink: String(localized: "Pink")
    case .red: String(localized: "Red")
    case .orange: String(localized: "Orange")
    case .yellow: String(localized: "Yellow")
    case .green: String(localized: "Green")
    case .neutral: String(localized: "Neutral")
    }
  }
}

#Preview {
  NavigationStack {
    AppearancePage()
  }
  .environment(AppModel(isDemo: true))
}

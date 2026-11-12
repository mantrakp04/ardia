import ArdiaDesign
import SwiftUI

struct ColorChoiceRows: View {
  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var look

  var body: some View {
    VStack(alignment: .leading, spacing: Spacing.small) {
      SettingsRowLabel("Color", systemImage: "paintpalette.fill", tint: look.swatchColor)
      HStack(spacing: 0) {
        ForEach(ProfileLook.Preset.allCases, id: \.self) { preset in
          Button {
            app.settings.colorChoice = preset.rawValue
          } label: {
            ColorSwatch(color: ProfileLook(preset: preset).swatchColor, isSelected: look.preset == preset)
              .frame(maxWidth: .infinity, minHeight: ColorSwatch.hitHeight)
              .contentShape(.rect)
          }
          .buttonStyle(.plain)
          .accessibilityLabel(preset.title)
          .accessibilityAddTraits(look.preset == preset ? .isSelected : [])
        }
      }
    }
    .padding(.vertical, Spacing.hairline)
    if app.sync.isEnabled {
      Toggle(isOn: matchesMac) {
        SettingsRowLabel("Match My Mac", systemImage: "macbook", tint: SettingsTint.neutral)
      }
    }
  }

  private var matchesMac: Binding<Bool> {
    Binding {
      app.settings.colorChoice == nil
    } set: { matches in
      app.settings.colorChoice = matches ? nil : (look.preset ?? .plum).rawValue
    }
  }
}

private struct ColorSwatch: View {
  static let side: CGFloat = 26
  static let ringGap: CGFloat = 3
  static let ringWidth: CGFloat = 2
  static let hitHeight: CGFloat = 44

  var color: Color
  var isSelected: Bool

  var body: some View {
    Circle()
      .fill(color)
      .frame(width: Self.side, height: Self.side)
      .padding(Self.ringGap + Self.ringWidth)
      .overlay {
        if isSelected {
          Circle().strokeBorder(color, lineWidth: Self.ringWidth)
        }
      }
      .animation(Motion.snappy, value: isSelected)
  }
}

extension ProfileLook.Preset {
  var title: LocalizedStringKey {
    switch self {
    case .plum: "Plum"
    case .blue: "Blue"
    case .purple: "Purple"
    case .pink: "Pink"
    case .red: "Red"
    case .orange: "Orange"
    case .yellow: "Yellow"
    case .green: "Green"
    case .neutral: "Neutral"
    }
  }
}

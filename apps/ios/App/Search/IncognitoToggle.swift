import ArdiaDesign
import SwiftUI

struct IncognitoToggle: View {
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if isOn {
          Text("Incognito")
            .font(.footnote.weight(.medium))
            .foregroundStyle(.white.opacity(0.75))
            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .trailing)))
        }
        IncognitoEyes(isOpen: isOn)
          .frame(width: 22)
          .foregroundStyle(isOn ? Color.white.opacity(0.85) : BrowsePalette.foregroundTertiary)
      }
      .padding(.horizontal, 6)
      .frame(minWidth: 36, minHeight: 40)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(isOn ? "Deactivate Incognito" : "Activate Incognito")
  }
}

import ArdiaDesign
import SwiftUI

struct IncognitoToggle: View {
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "eyeglasses")
        .font(.system(size: 17, weight: .semibold))
        .frame(width: 22)
        .foregroundStyle(isOn ? Tokens.Role.textPrimary : Tokens.Role.textTertiary)
        .padding(.horizontal, Tokens.Space.s)
        .frame(minWidth: 36, minHeight: 40)
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(isOn ? "Deactivate Incognito" : "Activate Incognito")
    .help(isOn ? "Deactivate Incognito" : "Activate Incognito")
  }
}

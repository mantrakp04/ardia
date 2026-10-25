import ArdiaDesign
import SwiftUI

struct PressableCardStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .opacity(configuration.isPressed ? 0.85 : 1)
      .animation(.spring(duration: 0.14, bounce: 0), value: configuration.isPressed)
  }
}

struct BlurReveal: ViewModifier {
  var radius: CGFloat = 10
  var isEnabled = true
  @State private var revealed = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    content
      .blur(radius: revealed || reduceMotion || !isEnabled ? 0 : radius)
      .opacity(revealed || !isEnabled ? 1 : 0)
      .onAppear {
        guard isEnabled else { return }
        withAnimation(IntelligenceMotion.reveal) { revealed = true }
      }
  }
}

extension View {
  func blurReveal(radius: CGFloat = 10, isEnabled: Bool = true) -> some View {
    modifier(BlurReveal(radius: radius, isEnabled: isEnabled))
  }
}

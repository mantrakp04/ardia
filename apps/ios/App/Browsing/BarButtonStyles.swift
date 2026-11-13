import ArdiaDesign
import SwiftUI

struct PressableStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.94 : 1)
      .animation(Motion.press, value: configuration.isPressed)
  }
}

struct GlassBarPieceStyle: ButtonStyle {
  let shape: GlassControlShape
  var morphID: String?

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .glassControl(shape, state: configuration.isPressed ? .pressed : .rest, morphID: morphID)
      .sensoryFeedback(.impact(weight: .light, intensity: 0.5), trigger: configuration.isPressed) { _, pressed in pressed }
  }
}

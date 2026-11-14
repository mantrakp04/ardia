import ArdiaDesign
import SwiftUI

struct CommandBarPlacement: Equatable {
  let top: CGFloat
  let maxHeight: CGFloat

  init(proxy: GeometryProxy, lift: CGFloat) {
    let safeTop = proxy.safeAreaInsets.top
    top = DuoLayout.cardTop(safeTop: safeTop) + DuoLayout.commandTop - safeTop
    let keyboardTop = proxy.size.height + proxy.safeAreaInsets.bottom - lift
    maxHeight = max(min(DuoLayout.commandMaxHeight, keyboardTop - top - DuoLayout.commandAboveKeyboard), 0)
  }
}

struct CommandBarFrame: ViewModifier {
  let placement: CommandBarPlacement?
  let isUp: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    if let placement {
      content
        .padding(.horizontal, DuoLayout.commandSide)
        .padding(.top, placement.top)
        .scaleEffect(isUp || reduceMotion ? 1 : 0.96, anchor: .top)
    } else {
      content
    }
  }
}

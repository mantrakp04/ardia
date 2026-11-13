import ArdiaDesign
import SwiftUI

struct ComposedPage<Illustration: View, Content: View>: View {
  var illustration: Illustration
  var content: Content

  @Environment(\.onboardingFrame) private var frame

  init(@ViewBuilder illustration: () -> Illustration, @ViewBuilder content: () -> Content) {
    self.illustration = illustration()
    self.content = content()
  }

  var body: some View {
    ScrollView {
      composition
        .padding(.vertical, Tokens.Space.xxxl)
        .padding(.horizontal, Tokens.Space.xxxl)
        .frame(maxWidth: .infinity, minHeight: frame.contentHeight)
    }
    .scrollBounceBehavior(.basedOnSize)
  }

  @ViewBuilder
  private var composition: some View {
    switch frame.composition {
    case .sideBySide:
      HStack(spacing: Tokens.Space.huge) {
        illustration
          .frame(maxWidth: PageComposition.columnWidth)
          .frame(maxWidth: .infinity)
        content
          .frame(maxWidth: PageComposition.sideBySideCopyWidth)
      }
    case .column, .stacked:
      VStack(spacing: Tokens.Space.huge) {
        illustration
          .frame(maxWidth: PageComposition.columnWidth)
        content
          .frame(maxWidth: PageComposition.columnWidth)
      }
    }
  }
}

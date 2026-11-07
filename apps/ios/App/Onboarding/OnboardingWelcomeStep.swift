import ArdiaDesign
import SwiftUI

struct OnboardingWelcomeStep: View {
  var onContinue: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var hasAppeared = false
  @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 40

  var body: some View {
    if dynamicTypeSize.isAccessibilitySize {
      ScrollView { content.padding(.top, Spacing.section) }
        .scrollBounceBehavior(.basedOnSize)
    } else {
      content
    }
  }

  private var content: some View {
    VStack(spacing: Spacing.large) {
      Spacer(minLength: 0)
      AppIconPreview(side: 104)
        .padding(5)
        .background(.white, in: .rect(cornerRadius: 104 * 0.225 + 5, style: .continuous))
        .shadow(color: Palette.gradientDeep.opacity(0.35), radius: 24, y: 12)
        .rotationEffect(.degrees(hasAppeared || reduceMotion ? -6 : -18))
        .scaleEffect(hasAppeared || reduceMotion ? 1 : 0.7)
        .opacity(hasAppeared ? 1 : 0)
      VStack(spacing: Spacing.small) {
        Text("Meet your new favorite browser")
          .font(.system(size: titleSize, weight: .bold, design: .rounded))
          .multilineTextAlignment(.center)
          .minimumScaleFactor(0.6)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
        Text("Get what you want twice as fast.")
          .font(.title3.weight(.medium))
          .fixedSize(horizontal: false, vertical: true)
          .foregroundStyle(.white.opacity(0.8))
          .multilineTextAlignment(.center)
      }
      .foregroundStyle(.white)
      .padding(.horizontal, Spacing.section)
      .opacity(hasAppeared ? 1 : 0)
      .offset(y: hasAppeared || reduceMotion ? 0 : 16)
      Spacer(minLength: 0)
      Button(action: onContinue) {
        Text("Get Started")
          .font(.body.weight(.semibold))
          .foregroundStyle(Palette.indigo)
          .frame(maxWidth: .infinity, minHeight: 50)
      }
      .buttonStyle(.borderedProminent)
      .buttonBorderShape(.roundedRectangle(radius: 14))
      .tint(.white)
      .padding(.horizontal, Spacing.medium + 4)
      .padding(.bottom, Spacing.small)
      .opacity(hasAppeared ? 1 : 0)
    }
    .onAppear {
      withAnimation(reduceMotion ? .easeOut(duration: 0.3) : .spring(duration: 0.7, bounce: 0.3).delay(0.1)) {
        hasAppeared = true
      }
    }
  }
}

#Preview("Welcome") {
  ZStack {
    LaunchGradient().ignoresSafeArea()
    OnboardingWelcomeStep(onContinue: {})
  }
}

import ArdiaDesign
import SwiftUI

struct OnboardingWelcomeStep: View {
  var onContinue: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @State private var hasAppeared = false
  @ScaledMetric(relativeTo: .title) private var titleSize: CGFloat = 28

  var body: some View {
    if dynamicTypeSize.isAccessibilitySize {
      ScrollView { content.padding(.top, Spacing.section) }
        .scrollBounceBehavior(.basedOnSize)
    } else {
      content
    }
  }

  private var content: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 0)
      AppIconPreview(side: 104)
        .padding(5)
        .background(.white, in: .rect(cornerRadius: 104 * 0.225 + 5, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 24, y: 12)
        .rotationEffect(.degrees(hasAppeared || reduceMotion ? -6 : -18))
        .scaleEffect(hasAppeared || reduceMotion ? 1 : 0.7)
        .opacity(hasAppeared ? 1 : 0)
        .padding(.bottom, Spacing.large)
      VStack(spacing: Spacing.small) {
        Text("Meet your new favorite browser")
          .font(.system(size: titleSize, weight: .bold))
          .multilineTextAlignment(.center)
          .minimumScaleFactor(0.6)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
        Text("Get what you want twice as fast.")
          .font(.body)
          .fixedSize(horizontal: false, vertical: true)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
      .foregroundStyle(.primary)
      .padding(.horizontal, Spacing.section)
      .opacity(hasAppeared ? 1 : 0)
      .offset(y: hasAppeared || reduceMotion ? 0 : 16)
      Spacer(minLength: 0)
      OnboardingPrimaryButton("Get Started", action: onContinue)
        .padding(.top, Spacing.large)
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
    ProfileBackdrop().ignoresSafeArea()
    OnboardingWelcomeStep(onContinue: {})
  }
}

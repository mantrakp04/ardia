import ArdiaDesign
import SwiftUI

struct OnboardingWelcomeStep: View {
  var onContinue: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.onboardingFrame) private var frame
  @State private var hasAppeared = false

  var body: some View {
    Group {
      switch frame.composition {
      case .stacked:
        if dynamicTypeSize.isAccessibilitySize {
          ScrollView { stacked.padding(.top, Tokens.Space.huge) }
            .scrollBounceBehavior(.basedOnSize)
        } else {
          stacked
        }
      case .column:
        ComposedPage {
          icon
        } content: {
          VStack(spacing: Tokens.Space.xxxl) {
            copy(alignment: .center)
            button
          }
        }
      case .sideBySide:
        ComposedPage {
          icon
        } content: {
          VStack(alignment: .leading, spacing: Tokens.Space.xxxl) {
            copy(alignment: .leading)
            button
          }
        }
      }
    }
    .onAppear {
      withAnimation(reduceMotion ? .easeOut(duration: 0.3) : .spring(duration: 0.7, bounce: 0.3).delay(0.1)) {
        hasAppeared = true
      }
    }
  }

  private var stacked: some View {
    VStack(spacing: Tokens.Space.xxxl) {
      Spacer(minLength: 0)
      icon
      copy(alignment: .center)
      Spacer(minLength: 0)
      button
        .padding(.horizontal, Tokens.Space.xxl + Tokens.Space.xs)
        .padding(.bottom, Tokens.Space.l)
    }
  }

  private var icon: some View {
    let side = frame.composition == .stacked ? OnboardingMetrics.welcomeIcon : OnboardingMetrics.welcomeIconWide
    let rim = OnboardingMetrics.welcomeIconRim
    return AppIconPreview(side: side)
      .padding(rim)
      .background(.white, in: .rect(cornerRadius: side * AppIconPreview.cornerShare + rim, style: .continuous))
      .shadow(Tokens.Shadow.dialog)
      .rotationEffect(.degrees(hasAppeared || reduceMotion ? OnboardingMetrics.welcomeTilt : OnboardingMetrics.welcomeTiltStart))
      .scaleEffect(hasAppeared || reduceMotion ? 1 : 0.7)
      .opacity(hasAppeared ? 1 : 0)
  }

  private func copy(alignment: HorizontalAlignment) -> some View {
    let isCentered = alignment == .center
    return VStack(alignment: alignment, spacing: Tokens.Space.l) {
      Text("Meet your new favorite browser")
        .typography(.display)
        .multilineTextAlignment(isCentered ? .center : .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
      Text("Get what you want twice as fast.")
        .font(Typography.title.weight(.medium))
        .fixedSize(horizontal: false, vertical: true)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(isCentered ? .center : .leading)
    }
    .foregroundStyle(.primary)
    .padding(.horizontal, isCentered ? Tokens.Space.huge : 0)
    .opacity(hasAppeared ? 1 : 0)
    .offset(y: hasAppeared || reduceMotion ? 0 : Tokens.Space.xl)
  }

  private var button: some View {
    Button(action: onContinue) {
      Text("Get Started")
        .font(Typography.title)
        .frame(maxWidth: .infinity, minHeight: SettingsLayout.primaryButtonHeight)
    }
    .buttonStyle(.glassPrimaryAction)
    .opacity(hasAppeared ? 1 : 0)
  }
}

#Preview("Welcome") {
  ZStack {
    ProfileBackdrop().ignoresSafeArea()
    OnboardingWelcomeStep(onContinue: {})
  }
}

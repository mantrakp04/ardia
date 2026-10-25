import ArdiaDesign
import SwiftUI
import UIKit

enum OnboardingStep: Int, CaseIterable, Comparable {
  case welcome
  case browseForMe
  case pinchToSummarize
  case blocking
  case defaultBrowser
  case sync
  case allSet

  static func < (lhs: OnboardingStep, rhs: OnboardingStep) -> Bool {
    lhs.rawValue < rhs.rawValue
  }

  var teachesAIFeature: Bool {
    self == .browseForMe || self == .pinchToSummarize
  }

  func next(aiFeatures: Bool) -> OnboardingStep? {
    Self.allCases.first { $0 > self && (aiFeatures || !$0.teachesAIFeature) }
  }

  static var launchStep: OnboardingStep {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "-ArdiaOnboardingStep"), arguments.indices.contains(index + 1),
      let raw = Int(arguments[index + 1]), let step = OnboardingStep(rawValue: raw)
    else { return .welcome }
    return step
  }
}

struct OnboardingView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var step: OnboardingStep = .launchStep
  @State private var advances = 0

  var body: some View {
    ZStack {
      if step == .welcome {
        LaunchGradient()
          .ignoresSafeArea()
          .transition(.opacity)
      } else {
        OnboardingBackdrop()
          .transition(.opacity)
      }

      Group {
        switch step {
        case .welcome: OnboardingWelcomeStep(onContinue: advance)
        case .browseForMe: OnboardingBrowseStep(onContinue: advance)
        case .pinchToSummarize: OnboardingPinchStep(onContinue: advance)
        case .blocking: OnboardingBlockingStep(onContinue: advance)
        case .defaultBrowser: OnboardingDefaultBrowserStep(onContinue: advance)
        case .sync: OnboardingSyncStep(onContinue: advance)
        case .allSet: OnboardingAllSetStep(onFinish: finish)
        }
      }
      .id(step)
      .transition(stepTransition)
    }
    .sensoryFeedback(.selection, trigger: advances)
    .onAppear(perform: Self.dismissKeyboard)
    .onChange(of: step) { _, _ in Self.dismissKeyboard() }
  }

  static func dismissKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
  }

  private var stepTransition: AnyTransition {
    reduceMotion
      ? .opacity
      : .asymmetric(
          insertion: .offset(x: 60).combined(with: .opacity),
          removal: .offset(x: -60).combined(with: .opacity)
        )
  }

  private func advance() {
    guard let next = step.next(aiFeatures: app.settings.aiFeaturesEnabled) else { return finish() }
    advances += 1
    withAnimation(reduceMotion ? .easeInOut(duration: 0.25) : Motion.smooth) {
      step = next
    }
  }

  private func finish() {
    app.settings.finishOnboarding()
  }
}

struct OnboardingCover: ViewModifier {
  @Environment(AppModel.self) private var app

  func body(content: Content) -> some View {
    @Bindable var settings = app.settings
    content
      .fullScreenCover(isPresented: $settings.isShowingOnboarding, onDismiss: {
        if !app.settings.hasFinishedOnboarding { app.settings.finishOnboarding() }
      }) {
        OnboardingView()
      }
      .launchHooks()
      .onChange(of: app.sheet) { _, sheet in
        guard sheet == .onboarding else { return }
        app.sheet = nil
        app.settings.showOnboarding()
      }
  }
}

extension View {
  func onboardingCover() -> some View {
    modifier(OnboardingCover())
  }
}

#Preview("Onboarding") {
  OnboardingView()
    .environment(AppModel(isDemo: true))
}

import ArdiaDesign
import SwiftUI
import UIKit

nonisolated struct OnboardingFrame: Equatable, Sendable {
  var size: CGSize
  var insets: EdgeInsets

  init(size: CGSize = .zero, insets: EdgeInsets = EdgeInsets()) {
    self.size = size
    self.insets = insets
  }

  var composition: PageComposition { PageComposition(size: size) }

  var horizontalInset: CGFloat { max(insets.leading, insets.trailing) }

  var contentHeight: CGFloat { max(0, size.height - insets.top - insets.bottom) }

  @MainActor static var sceneSize: CGSize {
    if let canvas = DemoLaunch.current.canvas { return canvas }
    return UIApplication.shared.connectedScenes.lazy.compactMap { $0 as? UIWindowScene }.first?.effectiveGeometry.coordinateSpace.bounds.size ?? .zero
  }
}

extension EnvironmentValues {
  @Entry var onboardingFrame = OnboardingFrame()
}

struct OnboardingFrameProbe: View {
  @Binding var frame: OnboardingFrame

  var body: some View {
    Color.clear
      .ignoresSafeArea()
      .onGeometryChange(for: OnboardingFrame.self) { proxy in
        OnboardingFrame(size: proxy.size, insets: proxy.safeAreaInsets)
      } action: { measured in
        frame = measured
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

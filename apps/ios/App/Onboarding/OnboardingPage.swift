import ArdiaDesign
import SwiftUI

struct OnboardingPage<Illustration: View, Actions: View>: View {
  var title: Text
  var subtitle: Text
  @ViewBuilder var illustration: Illustration
  @ViewBuilder var actions: Actions

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    if dynamicTypeSize.isAccessibilitySize {
      ScrollView {
        page(scrolls: true)
      }
      .scrollBounceBehavior(.basedOnSize)
    } else {
      page(scrolls: false)
    }
  }

  private func page(scrolls: Bool) -> some View {
    VStack(spacing: 0) {
      illustration
        .frame(maxWidth: .infinity, minHeight: scrolls ? 260 : nil, maxHeight: scrolls ? nil : .infinity)
        .padding(.horizontal, Spacing.page)
        .padding(.top, scrolls ? Spacing.large : 0)
      VStack(spacing: Spacing.small) {
        title
          .font(.system(.largeTitle, design: .rounded, weight: .bold))
          .foregroundStyle(Color.ardiaTitle)
          .multilineTextAlignment(.center)
          .minimumScaleFactor(0.8)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
        subtitle
          .font(.body)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .contentTransition(.opacity)
      }
      .padding(.horizontal, Spacing.section)
      .padding(.top, Spacing.medium)
      VStack(spacing: Spacing.tight) {
        actions
      }
      .padding(.horizontal, Spacing.medium + 4)
      .padding(.top, Spacing.large)
      .padding(.bottom, Spacing.small)
    }
  }
}

struct OnboardingBackdrop: View {
  var body: some View {
    ZStack {
      Color(.systemBackground)
      LaunchGradient(softened: true)
        .mask {
          LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black.opacity(0.6), location: 0.45), .init(color: .clear, location: 0.8)], startPoint: .top, endPoint: .bottom)
        }
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}

struct OnboardingPrimaryButton: View {
  var title: LocalizedStringKey
  var action: () -> Void

  init(_ title: LocalizedStringKey, action: @escaping () -> Void) {
    self.title = title
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      Text(title)
        .font(.body.weight(.semibold))
        .frame(maxWidth: .infinity, minHeight: 50)
    }
    .buttonStyle(.borderedProminent)
    .buttonBorderShape(.roundedRectangle(radius: 14))
    .tint(Palette.indigo)
  }
}

struct OnboardingSecondaryButton: View {
  var title: LocalizedStringKey
  var action: () -> Void

  init(_ title: LocalizedStringKey, action: @escaping () -> Void) {
    self.title = title
    self.action = action
  }

  var body: some View {
    Button(title, action: action)
      .font(.body.weight(.semibold))
      .foregroundStyle(Color.ardiaTitle)
      .frame(maxWidth: .infinity, minHeight: 44)
      .contentShape(.rect)
  }
}

extension Text {
  static func emphasized(_ key: LocalizedStringKey) -> Text {
    Text(key).foregroundStyle(Color.ardiaAccentText)
  }
}

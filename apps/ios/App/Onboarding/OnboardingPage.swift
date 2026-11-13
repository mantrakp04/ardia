import ArdiaDesign
import SwiftUI

struct OnboardingPage<Illustration: View, Actions: View>: View {
  var title: Text
  var subtitle: Text
  var illustrationAlignment: Alignment
  var illustration: Illustration
  var actions: Actions

  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.onboardingFrame) private var frame

  init(
    title: Text,
    subtitle: Text,
    illustrationAlignment: Alignment = .center,
    @ViewBuilder illustration: () -> Illustration,
    @ViewBuilder actions: () -> Actions
  ) {
    self.title = title
    self.subtitle = subtitle
    self.illustrationAlignment = illustrationAlignment
    self.illustration = illustration()
    self.actions = actions()
  }

  var body: some View {
    switch frame.composition {
    case .stacked:
      if dynamicTypeSize.isAccessibilitySize {
        ScrollView {
          stacked(scrolls: true)
        }
        .scrollBounceBehavior(.basedOnSize)
      } else {
        stacked(scrolls: false)
      }
    case .column:
      ComposedPage {
        illustration
      } content: {
        VStack(spacing: Tokens.Space.xxxl) {
          copy(alignment: .center)
          VStack(spacing: Tokens.Space.m) { actions }
        }
      }
    case .sideBySide:
      ComposedPage {
        illustration
      } content: {
        VStack(alignment: .leading, spacing: Tokens.Space.xxxl) {
          copy(alignment: .leading)
          VStack(spacing: Tokens.Space.m) { actions }
        }
      }
    }
  }

  private func stacked(scrolls: Bool) -> some View {
    VStack(spacing: 0) {
      illustration
        .frame(maxWidth: .infinity, minHeight: scrolls ? OnboardingMetrics.scrollingIllustrationHeight : nil, maxHeight: scrolls ? nil : .infinity, alignment: illustrationAlignment)
        .padding(.horizontal, Tokens.Space.xl)
        .padding(.top, scrolls ? Tokens.Space.xxxl : 0)
      copy(alignment: .center)
        .padding(.horizontal, Tokens.Space.huge)
        .padding(.top, Tokens.Space.xxl)
      VStack(spacing: Tokens.Space.m) {
        actions
      }
      .padding(.horizontal, Tokens.Space.xxl + Tokens.Space.xs)
      .padding(.top, Tokens.Space.xxxl)
      .padding(.bottom, Tokens.Space.l)
    }
  }

  private func copy(alignment: HorizontalAlignment) -> some View {
    let isCentered = alignment == .center
    return VStack(alignment: alignment, spacing: Tokens.Space.l) {
      title
        .typography(.display)
        .foregroundStyle(Color.ardiaTitle)
        .multilineTextAlignment(isCentered ? .center : .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
      subtitle
        .font(Typography.body)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(isCentered ? .center : .leading)
        .fixedSize(horizontal: false, vertical: true)
        .contentTransition(.opacity)
    }
  }
}

enum OnboardingMetrics {
  static let scrollingIllustrationHeight: CGFloat = 260
  static let welcomeIcon: CGFloat = 104
  static let welcomeIconWide: CGFloat = 136
  static let welcomeIconRim: CGFloat = 5
  static let welcomeTilt: Double = -6
  static let welcomeTiltStart: Double = -18
}

struct OnboardingBackdrop: View {
  var body: some View {
    ZStack {
      Color(.systemBackground)
      ProfileBackdrop(softened: true)
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
        .font(Typography.title)
        .frame(maxWidth: .infinity, minHeight: SettingsLayout.primaryButtonHeight)
    }
    .buttonStyle(.glassPrimaryAction)
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
      .font(Typography.title)
      .foregroundStyle(Color.ardiaTitle)
      .frame(maxWidth: .infinity, minHeight: GlassMetrics.hitTarget)
      .contentShape(.rect)
  }
}

extension Text {
  static func emphasized(_ key: LocalizedStringKey) -> Text {
    Text(key).foregroundStyle(Color.ardiaAccentText)
  }
}

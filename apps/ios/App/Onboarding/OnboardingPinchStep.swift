import ArdiaDesign
import SwiftUI

struct OnboardingPinchStep: View {
  var onContinue: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @GestureState private var pinch: CGFloat = 1
  @State private var phase: Phase = .page
  @State private var summaries = 0

  enum Phase {
    case page
    case folding
    case summary
  }

  var body: some View {
    OnboardingPage(
      title: Text("\(Text.emphasized("Pinch")) to summarize \(Text.emphasized("any")) web page"),
      subtitle: phase == .summary ? Text("Summarized for you, right on this iPhone.") : Text("Pinch the page to continue")
    ) {
      ZStack {
        if phase == .summary {
          DemoSummaryCard()
            .dynamicTypeSize(...DynamicTypeSize.large)
            .transition(summaryTransition)
        } else {
          DemoArticle()
            .dynamicTypeSize(...DynamicTypeSize.large)
            .scaleEffect(pageScale)
            .rotation3DEffect(.degrees(phase == .folding ? 88 : 0), axis: (x: 1, y: 0, z: 0), anchor: .center, perspective: 0.6)
            .opacity(phase == .folding ? 0.4 : 1)
            .overlay(alignment: .bottom) {
              PinchHint()
                .dynamicTypeSize(...DynamicTypeSize.large)
                .padding(.bottom, Spacing.page)
                .opacity(pinch < 0.98 || phase != .page ? 0 : 1)
            }
            .gesture(pinchGesture)
            .accessibilityAction(named: Text("Summarize")) { summarize() }
            .transition(.opacity)
        }
      }
      .padding(.top, Spacing.page)
    } actions: {
      if phase == .summary {
        OnboardingPrimaryButton("Continue", action: onContinue)
      } else {
        OnboardingSecondaryButton("Skip for Now", action: onContinue)
      }
    }
    .animation(Motion.smooth, value: phase == .summary)
    .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.8), trigger: summaries)
  }

  static let pinchCommit: CGFloat = 0.72

  private var pageScale: CGFloat {
    let pulled = max(0, 1 - pinch)
    return 1 - min(0.07, pulled * 0.18)
  }

  private var summaryTransition: AnyTransition {
    reduceMotion ? .opacity : .modifier(active: FlipIn(angle: -88), identity: FlipIn(angle: 0)).combined(with: .opacity)
  }

  private var pinchGesture: some Gesture {
    MagnifyGesture()
      .updating($pinch) { value, state, _ in
        guard phase == .page else { return }
        state = value.magnification
      }
      .onEnded { value in
        guard phase == .page, value.magnification < Self.pinchCommit else { return }
        summarize()
      }
  }

  private func summarize() {
    guard phase == .page else { return }
    summaries += 1
    if reduceMotion {
      withAnimation(.easeInOut(duration: 0.25)) { phase = .summary }
      return
    }
    withAnimation(.easeIn(duration: 0.2)) {
      phase = .folding
    } completion: {
      withAnimation(.spring(duration: 0.45, bounce: 0.18)) { phase = .summary }
    }
  }
}

private struct FlipIn: ViewModifier {
  var angle: Double

  func body(content: Content) -> some View {
    content.rotation3DEffect(.degrees(angle), axis: (x: 1, y: 0, z: 0), anchor: .center, perspective: 0.6)
  }
}

private struct PinchHint: View {
  var body: some View {
    Label("Pinch me!", systemImage: "hand.pinch.fill")
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(.white)
      .padding(.horizontal, 14)
      .frame(height: 34)
      .background(Palette.toast.gradient, in: .capsule)
      .shadow(color: Palette.toastShadow.opacity(0.3), radius: 10, y: 4)
      .accessibilityHidden(true)
  }
}

private struct DemoArticle: View {
  var body: some View {
    VStack(alignment: .leading, spacing: Spacing.small) {
      Text("The Last Lighthouse Keepers")
        .font(.system(.title2, design: .serif, weight: .bold))
      Text("Long read · 14 min")
        .font(.footnote)
        .foregroundStyle(.secondary)
      Text("For two centuries, a lighthouse meant a keeper. Someone had to climb the tower at dusk, trim the wick, wind the clockwork that turned the lens, and stay awake until dawn. Most stations were run by a family, and many keepers spent decades on rocks a few hundred yards long.")
      Text("Automation arrived slowly, then all at once. Electric lamps removed the wick, timers replaced the climb at dusk, and radio beacons and satellite navigation made the light itself a backup. By the end of the twentieth century, nearly every tower ran on its own.")
      Text("The towers still stand. Some are museums, some are holiday rentals, and a few are kept lit by volunteers who think a coast should still have a light on it.")
    }
    .font(.system(.subheadline, design: .serif))
    .lineSpacing(2)
    .foregroundStyle(.primary)
    .padding(Spacing.medium)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(.background, in: .rect(cornerRadius: Radius.card, style: .continuous))
    .clipShape(.rect(cornerRadius: Radius.card, style: .continuous))
    .shadow(color: .black.opacity(0.1), radius: 20, y: 8)
    .accessibilityElement(children: .combine)
    .accessibilityHint(Text("Pinch with two fingers to summarize, or use the Summarize action."))
  }
}

private struct DemoSummaryCard: View {
  var body: some View {
    VStack(alignment: .leading, spacing: Spacing.small) {
      Label("Summarized for you", systemImage: "sparkles")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.secondary)
      Text("Lighthouses went from family homes to machines that run themselves.")
        .font(.system(.title3, design: .rounded, weight: .bold))
        .foregroundStyle(Color.ardiaAccentText)
      VStack(alignment: .leading, spacing: Spacing.small) {
        SummaryPoint(symbol: "flame.fill", lead: "Keepers", text: "climbed every dusk to light, wind and watch the lamp.")
        SummaryPoint(symbol: "bolt.fill", lead: "Automation", text: "replaced the wick, the climb and finally the keeper.")
        SummaryPoint(symbol: "building.columns.fill", lead: "Today", text: "the towers are museums, rentals or volunteer-run lights.")
      }
      .padding(.top, Spacing.hairline)
    }
    .padding(Spacing.medium)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.background, in: .rect(cornerRadius: Radius.card, style: .continuous))
    .shadow(color: Palette.indigo.opacity(0.14), radius: 24, y: 10)
    .accessibilityElement(children: .combine)
  }
}

private struct SummaryPoint: View {
  var symbol: String
  var lead: LocalizedStringKey
  var text: LocalizedStringKey

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Spacing.tight + 2) {
      Image(systemName: symbol)
        .font(.caption.weight(.semibold))
        .foregroundStyle(Color.ardiaAccentText)
        .frame(width: 26, height: 26)
        .background(Palette.indigo.opacity(0.12), in: .rect(cornerRadius: 7, style: .continuous))
        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 5 }
        .accessibilityHidden(true)
      Text("\(Text(lead).bold()) \(Text(text))")
        .font(.subheadline)
    }
  }
}

#Preview("Pinch to Summarize") {
  ZStack {
    OnboardingBackdrop()
    OnboardingPinchStep(onContinue: {})
  }
}

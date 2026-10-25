import ArdiaDesign
import SwiftUI

struct OnboardingBrowseStep: View {
  var onContinue: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var chosen: OnboardingQuery?
  @State private var stage = 0
  @State private var finished = 0

  var body: some View {
    OnboardingPage(
      title: Text("Let Ardia \(Text.emphasized("search")) and \(Text.emphasized("summarize for you"))"),
      subtitle: stage >= OnboardingQuery.finalStage
        ? Text("Browse for Me reads the pages and writes you one with the answer.")
        : Text("Try a search to continue")
    ) {
      ZStack {
        if let chosen {
          BuiltPagePreview(query: chosen, stage: stage)
            .dynamicTypeSize(...DynamicTypeSize.large)
            .transition(.scale(scale: 0.94).combined(with: .opacity))
        } else {
          VStack(spacing: 0) {
            ForEach(OnboardingQuery.all) { query in
              QueryRow(query: query, isHighlighted: query == OnboardingQuery.all.first) { choose(query) }
              if query != OnboardingQuery.all.last {
                Divider().padding(.leading, 44)
              }
            }
          }
          .padding(.vertical, Spacing.hairline)
          .dynamicTypeSize(...DynamicTypeSize.large)
          .background(.background.opacity(0.85), in: .rect(cornerRadius: Radius.card, style: .continuous))
          .shadow(color: .black.opacity(0.06), radius: 16, y: 6)
          .transition(.opacity)
        }
      }
      .padding(.top, Spacing.large)
    } actions: {
      if stage >= OnboardingQuery.finalStage {
        OnboardingPrimaryButton("Continue", action: onContinue)
      } else {
        OnboardingSecondaryButton("Skip for Now", action: onContinue)
      }
    }
    .animation(Motion.smooth, value: chosen)
    .animation(Motion.smooth, value: stage >= OnboardingQuery.finalStage)
    .sensoryFeedback(.success, trigger: finished)
    .task(id: chosen) {
      guard chosen != nil else { return }
      for next in 1...OnboardingQuery.finalStage {
        try? await Task.sleep(for: .milliseconds(reduceMotion ? 120 : 420))
        if Task.isCancelled { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.snappy) { stage = next }
      }
      finished += 1
    }
  }

  private func choose(_ query: OnboardingQuery) {
    guard chosen == nil else { return }
    stage = 0
    chosen = query
  }
}

struct OnboardingQuery: Identifiable, Equatable {
  var id: String { text }
  var text: String
  var title: String
  var sources: [String]
  var points: [String]

  static let finalStage = 4

  static let all: [OnboardingQuery] = [
    OnboardingQuery(
      text: String(localized: "weekend in lisbon"),
      title: String(localized: "A Weekend in Lisbon"),
      sources: ["tram.pt", "visitlisboa.com", "timeout.com", "wikipedia.org"],
      points: [String(localized: "Ride Tram 28"), String(localized: "Sunset at a miradouro"), String(localized: "Pastéis in Belém")]
    ),
    OnboardingQuery(
      text: String(localized: "risotto vs paella"),
      title: String(localized: "Risotto vs. Paella"),
      sources: ["seriouseats.com", "bonappetit.com", "wikipedia.org"],
      points: [String(localized: "Stirred vs. left alone"), String(localized: "Arborio vs. bomba rice"), String(localized: "Creamy vs. crisp socarrat")]
    ),
    OnboardingQuery(
      text: String(localized: "veggie dinner ideas"),
      title: String(localized: "Veggie Dinner Ideas"),
      sources: ["nytimes.com", "budgetbytes.com", "bbcgoodfood.com"],
      points: [String(localized: "Chickpea curry"), String(localized: "Mushroom tacos"), String(localized: "Lemon orzo")]
    ),
    OnboardingQuery(
      text: String(localized: "how do tides work"),
      title: String(localized: "How Tides Work"),
      sources: ["noaa.gov", "nasa.gov", "britannica.com"],
      points: [String(localized: "The Moon’s pull"), String(localized: "Two bulges a day"), String(localized: "Spring and neap tides")]
    ),
  ]
}

private struct QueryRow: View {
  var query: OnboardingQuery
  var isHighlighted: Bool
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: Spacing.small) {
        Image(systemName: "magnifyingglass")
          .font(.body.weight(.medium))
          .foregroundStyle(.secondary)
          .frame(width: 20)
          .accessibilityHidden(true)
        Text(verbatim: query.text)
          .foregroundStyle(.primary)
          .lineLimit(1)
          .minimumScaleFactor(0.85)
        Spacer(minLength: Spacing.tight)
        Text("Browse for Me")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(isHighlighted ? AnyShapeStyle(.white) : AnyShapeStyle(BrowsePalette.foregroundSecondary))
          .padding(.horizontal, isHighlighted ? 12 : 10)
          .frame(height: isHighlighted ? 31 : 28.5)
          .background(isHighlighted ? AnyShapeStyle(Palette.indigo.gradient) : AnyShapeStyle(BrowsePalette.pillFill), in: .rect(cornerRadius: 8, style: .continuous))
          .shadow(color: isHighlighted ? Palette.indigo.opacity(0.35) : .clear, radius: 6, y: 3)
      }
      .padding(.horizontal, Spacing.small)
      .frame(minHeight: 58.5)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Text("Browse for Me: \(query.text)"))
  }
}

private struct BuiltPagePreview: View {
  var query: OnboardingQuery
  var stage: Int

  var body: some View {
    VStack(alignment: .leading, spacing: Spacing.small) {
      Text(verbatim: query.title)
        .font(.system(.title2, design: .rounded, weight: .bold))
        .foregroundStyle(Color.ardiaAccentText)
        .blur(radius: stage >= 1 ? 0 : 8)
        .opacity(stage >= 1 ? 1 : 0.3)

      HStack(spacing: -6) {
        ForEach(Array(query.sources.enumerated()), id: \.offset) { index, source in
          Circle()
            .fill(Self.sourceColors[index % Self.sourceColors.count].gradient)
            .frame(width: 22, height: 22)
            .overlay { Text(verbatim: String(source.prefix(1)).uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.white) }
            .overlay { Circle().strokeBorder(.background, lineWidth: 2) }
            .scaleEffect(stage >= 2 ? 1 : 0.4)
            .opacity(stage >= 2 ? 1 : 0)
        }
        Text("Read \(query.sources.count) pages")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .padding(.leading, Spacing.small + 4)
          .opacity(stage >= 2 ? 1 : 0)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(Text("Read \(query.sources.count) pages"))

      VStack(alignment: .leading, spacing: Spacing.tight) {
        ForEach(Array(query.points.enumerated()), id: \.offset) { index, point in
          HStack(spacing: Spacing.tight) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
              .fill(Palette.indigo.opacity(0.12))
              .frame(width: 24, height: 24)
              .overlay { Image(systemName: Self.symbols[index % Self.symbols.count]).font(.caption.weight(.semibold)).foregroundStyle(Color.ardiaAccentText) }
              .accessibilityHidden(true)
            Text(verbatim: point)
              .font(.subheadline.weight(.semibold))
            Capsule()
              .fill(.quaternary)
              .frame(height: 8)
              .frame(maxWidth: .infinity)
              .accessibilityHidden(true)
          }
          .opacity(stage >= 3 ? 1 : 0)
          .offset(y: stage >= 3 ? 0 : 8)
          .animation(Motion.snappy.delay(Double(index) * 0.08), value: stage >= 3)
        }
      }
      .padding(.top, Spacing.hairline)

      VStack(alignment: .leading, spacing: 6) {
        Capsule().fill(.quaternary).frame(height: 8)
        Capsule().fill(.quaternary).frame(height: 8).padding(.trailing, 40)
        Capsule().fill(.quaternary).frame(height: 8).padding(.trailing, 90)
      }
      .opacity(stage >= 4 ? 1 : 0)
      .accessibilityHidden(true)
    }
    .padding(Spacing.medium)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.background, in: .rect(cornerRadius: Radius.card, style: .continuous))
    .shadow(color: Palette.indigo.opacity(0.12), radius: 24, y: 10)
  }

  static let sourceColors: [Color] = [Palette.gradientViolet, Palette.gradientPink, Color(hex: 0x0C50FF), Palette.gradientPlum]
  static let symbols = ["mappin.and.ellipse", "sparkles", "fork.knife"]
}

#Preview("Browse for Me") {
  ZStack {
    OnboardingBackdrop()
    OnboardingBrowseStep(onContinue: {})
  }
}

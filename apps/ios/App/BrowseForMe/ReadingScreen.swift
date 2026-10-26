import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct ReadingScreen: View {
  let browse: BrowseForMe
  var onEditQuery: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  static let visibleDomains = 3

  var body: some View {
    ZStack(alignment: .topLeading) {
      RisingGradient(isAnimating: browse.isRunning)
      GeometryReader { proxy in
        VStack(alignment: .leading, spacing: 0) {
          Button(action: onEditQuery) {
            Text(browse.query)
              .multilineTextAlignment(.leading)
              .lineLimit(4)
              .frame(maxWidth: .infinity, alignment: .leading)
              .contentShape(.rect)
          }
          .buttonStyle(PressableCardStyle())
          .accessibilityLabel(browse.query)
          .accessibilityHint("Edits the search")
          Spacer(minLength: 32)
            .frame(maxHeight: proxy.size.height * 0.26)
          progress
          Spacer(minLength: 0)
        }
        .font(.title3.weight(.semibold))
        .fontDesign(.rounded)
        .foregroundStyle(IntelligencePalette.loadingInk)
        .padding(.horizontal, Spacing.section)
        .padding(.top, 28)
      }
    }
  }

  private var progress: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(browse.statusText)
        .contentTransition(reduceMotion ? .opacity : .numericText())
        .animation(IntelligenceMotion.ease, value: browse.statusText)
      ForEach(Array(domains.prefix(Self.visibleDomains).enumerated()), id: \.element) { index, host in
        Text(host)
          .lineLimit(1)
          .opacity(0.45)
          .transition(arrival(index))
      }
      if domains.count > Self.visibleDomains {
        Text(BrowseCopy.andMore)
          .opacity(0.45)
          .transition(arrival(Self.visibleDomains))
      }
    }
    .animation(IntelligenceMotion.ease, value: domains)
    .accessibilityElement(children: .combine)
  }

  private var domains: [String] {
    var seen: [String] = []
    for source in browse.sources where source.state != .failed && source.state != .skipped {
      let host = source.result.displayHost
      if !seen.contains(host) { seen.append(host) }
    }
    return seen
  }

  private func arrival(_ index: Int) -> AnyTransition {
    let base: AnyTransition = reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 12))
    return base.animation(IntelligenceMotion.ease.delay(IntelligenceMotion.domainDelay(index)))
  }
}

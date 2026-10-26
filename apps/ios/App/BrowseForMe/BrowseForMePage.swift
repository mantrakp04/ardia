import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct BrowseForMePage: View {
  struct Actions {
    var open: (URL) -> Void
    var search: (String) -> Void
    var ask: (String) -> Void
    var editQuery: (String) -> Void
    var finished: (BrowsePage) -> Void
    var openExperiments: () -> Void = {}
  }

  let browse: BrowseForMe
  var engineName: String
  var actions: Actions

  @Environment(\.openURL) private var openURL
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var finishedCount = 0
  @State private var animatesBuild: Bool
  @State private var holdsReading = false

  init(browse: BrowseForMe, engineName: String, actions: Actions) {
    self.browse = browse
    self.engineName = engineName
    self.actions = actions
    _animatesBuild = State(initialValue: browse.phase != .done)
  }

  private var page: BrowsePage { browse.page }

  private var showsReadingScreen: Bool {
    switch browse.phase {
    case .idle, .searching, .reading, .writing: page.title.isEmpty || holdsReading
    case .done, .failed, .cancelled: false
    }
  }

  var body: some View {
    ZStack {
      if showsReadingScreen {
        ReadingScreen(browse: browse) { actions.editQuery(browse.query) }
          .transition(.opacity)
      } else {
        pageLayer
          .transition(reduceMotion ? AnyTransition.opacity : AnyTransition(.blurReplace))
      }
    }
    .animation(reduceMotion ? .easeInOut(duration: 0.22) : IntelligenceMotion.backdrop, value: showsReadingScreen)
    .environment(\.openURL, OpenURLAction { url in
      actions.open(url)
      return .handled
    })
    .sensoryFeedback(.success, trigger: finishedCount)
    .task(id: browse.phase == .reading) {
      guard browse.phase == .reading else { return }
      holdsReading = true
      try? await Task.sleep(for: .seconds(1.4))
      holdsReading = false
    }
    .onChange(of: browse.phase) { previous, phase in
      guard phase == .done, previous == .writing else { return }
      finishedCount += 1
      actions.finished(browse.page)
    }
  }

  private var pageLayer: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        if showsCards {
          cardsRow
        }
        header
        content
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .contentMargins(.bottom, BrowseLayout.barHeight + 64, for: .scrollContent)
    .scrollIndicators(.hidden)
    .safeAreaBar(edge: .top) { queryBar }
    .scrollEdgeEffectStyle(.soft, for: .top)
    .background { IntelligencePalette.pageBackground.ignoresSafeArea() }
  }

  private var showsCards: Bool {
    if hasFailed { return false }
    if browse.phase == .cancelled { return !SourceCardModel.cards(for: browse).isEmpty }
    return true
  }

  private var cardsRow: some View {
    SourceCardsRow(
      query: browse.query, engineName: engineName, cards: SourceCardModel.cards(for: browse),
      showsPlaceholders: browse.phase == .searching || browse.phase == .idle,
      onSearch: { actions.search(browse.query) }, onOpen: actions.open)
    .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    .padding(.top, 4)
    .padding(.bottom, 20)
  }

  private var hasFailed: Bool {
    if case .failed = browse.phase { return true }
    return false
  }

  private var queryBar: some View {
    Button { actions.editQuery(browse.query) } label: {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .foregroundStyle(.secondary)
          .accessibilityHidden(true)
        Text(browse.query)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .font(.body)
      .padding(.horizontal, 16)
      .frame(maxWidth: .infinity, minHeight: 44)
      .glassEffect(.regular.interactive(), in: .capsule)
    }
    .buttonStyle(PressableCardStyle())
    .accessibilityLabel(browse.query)
    .accessibilityHint("Edits the search")
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, 6)
  }

  @ViewBuilder private var header: some View {
    if !page.title.isEmpty, !hasFailed {
      VStack(alignment: .leading, spacing: 18) {
        Text(page.title)
          .font(.title.weight(.heavy))
          .foregroundStyle(IntelligencePalette.ink)
          .kerning(-0.4)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
          .blurReveal(isEnabled: animatesBuild)
        if !page.heroImages.isEmpty {
          HeroGallery(images: page.heroImages)
            .transition(.opacity)
        }
      }
      .padding(.horizontal, Spacing.page)
      .padding(.bottom, 18)
    }
  }

  @ViewBuilder private var content: some View {
    VStack(alignment: .leading, spacing: 28) {
      if let failure = browse.failure {
        BrowseFailureView(
          failure: failure,
          onRetry: {
            animatesBuild = true
            browse.retry()
          },
          onOpenSettings: openSettings,
          onOpenExperiments: actions.openExperiments)
        if failure.showsSources, !browse.results.isEmpty {
          SourcesSection(
            title: BrowseCopy.topResults,
            links: browse.results.prefix(8).map { ($0.url, $0.title) },
            onOpen: actions.open)
        }
      } else if browse.phase == .cancelled {
        StoppedView { browse.retry() }
      } else {
        pageBody
      }
    }
    .padding(.horizontal, Spacing.page)
  }

  @ViewBuilder private var pageBody: some View {
    if !page.answer.isEmpty {
      Text(page.answer)
        .font(.body)
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
        .transition(.opacity)
    }
    ForEach(Array(page.sections.enumerated()), id: \.element.id) { index, section in
      VStack(alignment: .leading, spacing: 16) {
        if !section.heading.isEmpty {
          SectionHeading(section.heading)
        }
        ForEach(section.bullets) { bullet in
          BulletRow(bullet: bullet, sources: page.sources)
            .transition(.opacity)
        }
        if index == 0, browse.phase == .done, let quote = page.quote, let source = page.source(numbered: quote.source) {
          QuoteCard(quote: quote, source: source) { actions.open(source.url) }
            .padding(.top, 4)
            .transition(.opacity)
        }
      }
      .transition(.opacity)
    }
    .animation(reduceMotion ? nil : IntelligenceMotion.stream, value: page.sections.map(\.bullets.count))

    if browse.isRunning {
      ForEach(0..<max(1, 3 - page.sections.count), id: \.self) { _ in
        SkeletonSection()
      }
    }

    if browse.phase == .done, !page.followUps.isEmpty {
      FollowUpChips(questions: page.followUps, onAsk: actions.ask)
        .padding(.horizontal, -Spacing.page)
    }
  }

  private func openSettings() {
    if let url = URL(string: UIApplication.openSettingsURLString) {
      openURL(url)
    }
  }
}

private struct StoppedView: View {
  var onResume: () -> Void

  var body: some View {
    Button("Try Again", systemImage: "arrow.clockwise", action: onResume)
      .buttonStyle(.bordered)
      .tint(IntelligencePalette.ink)
      .frame(maxWidth: .infinity)
      .padding(.top, 24)
  }
}

#Preview("Building") {
  let intelligence = Intelligence.demo()
  let browse = intelligence.browse("what are dogs")
  BrowseForMePage(browse: browse, engineName: "Google", actions: .preview)
    .task { browse.start() }
}

#Preview("Offline") {
  let intelligence = Intelligence.demo(sourcing: DemoSourcing(.offline))
  let browse = intelligence.browse("things to do in joshua tree")
  BrowseForMePage(browse: browse, engineName: "Google", actions: .preview)
    .task { browse.start() }
}

#Preview("Apple Intelligence Off") {
  let intelligence = Intelligence.demo(status: .appleIntelligenceOff)
  let browse = intelligence.browse("things to do in joshua tree")
  BrowseForMePage(browse: browse, engineName: "Google", actions: .preview)
    .task { browse.start() }
}

extension BrowseForMePage.Actions {
  static let preview = BrowseForMePage.Actions(open: { _ in }, search: { _ in }, ask: { _ in }, editQuery: { _ in }, finished: { _ in })
}

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
  @Namespace private var morph
  @State private var finishedCount = 0
  @State private var animatesBuild: Bool

  init(browse: BrowseForMe, engineName: String, actions: Actions) {
    self.browse = browse
    self.engineName = engineName
    self.actions = actions
    _animatesBuild = State(initialValue: browse.phase != .done)
  }

  private var page: BrowsePage { browse.page }
  private var showsLoadingBackdrop: Bool {
    switch browse.phase {
    case .idle, .searching, .reading, .writing: page.title.isEmpty
    case .done, .failed, .cancelled: false
    }
  }

  var body: some View {
    ZStack {
      if showsLoadingBackdrop {
        loadingLayer
          .transition(.opacity)
      } else {
        pageLayer
          .transition(.opacity)
      }
    }
    .animation(layerAnimation, value: showsLoadingBackdrop)
    .environment(\.openURL, OpenURLAction { url in
      actions.open(url)
      return .handled
    })
    .sensoryFeedback(.success, trigger: finishedCount)
    .onChange(of: browse.phase) { previous, phase in
      guard phase == .done, previous == .writing else { return }
      finishedCount += 1
      actions.finished(browse.page)
    }
  }

  private var layerAnimation: Animation {
    if reduceMotion || hasFailed { return .easeInOut(duration: 0.22) }
    return IntelligenceMotion.backdrop
  }

  private var loadingLayer: some View {
    ZStack(alignment: .top) {
      DriftingMesh(isAnimating: true)
      VStack(alignment: .leading, spacing: 0) {
        loadingHeader
        cardsRow
        VStack(alignment: .leading, spacing: 28) {
          ForEach(0..<3, id: \.self) { _ in SkeletonSection() }
        }
        .padding(.horizontal, Spacing.page)
        .opacity(0.7)
        Spacer(minLength: 0)
      }
    }
  }

  private var pageLayer: some View {
    ZStack {
      IntelligencePalette.pageBackground
        .ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          builtHeader
          if !hasFailed || !SourceCardModel.cards(for: browse).isEmpty {
            cardsRow
          }
          content
        }
        .padding(.bottom, 120)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .safeAreaBar(edge: .top) { queryBar }
      .scrollEdgeEffectStyle(.hard, for: .top)
    }
  }

  private var cardsRow: some View {
    SourceCardsRow(
      query: browse.query, engineName: engineName, cards: SourceCardModel.cards(for: browse),
      showsPlaceholders: browse.phase == .searching || browse.phase == .idle,
      onSearch: { actions.search(browse.query) }, onOpen: actions.open)
    .matchedGeometryEffect(id: "cards", in: morph, properties: .position)
    .padding(.bottom, 24)
  }

  private var hasFailed: Bool {
    if case .failed = browse.phase { return true }
    return false
  }

  private var loadingHeader: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(browse.statusText)
        .font(.subheadline.weight(.medium))
        .foregroundStyle(IntelligencePalette.loadingStatus)
        .contentTransition(.opacity)
        .animation(.easeOut(duration: 0.2), value: browse.statusText)
      Text(browse.query.localizedCapitalized)
        .font(.title2.weight(.bold))
        .foregroundStyle(IntelligencePalette.loadingTitle)
        .fixedSize(horizontal: false, vertical: true)
        .matchedGeometryEffect(id: "query", in: morph, properties: .position, anchor: .leading)
        .blurReveal(isEnabled: animatesBuild)
    }
    .padding(.horizontal, Spacing.page)
    .padding(.top, 150)
    .padding(.bottom, 20)
    .accessibilityElement(children: .combine)
  }

  private var queryBar: some View {
    Button { actions.editQuery(browse.query) } label: {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .foregroundStyle(.secondary)
        Text(browse.query)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .matchedGeometryEffect(id: "query", in: morph, properties: .position, anchor: .leading)
        Spacer(minLength: 0)
      }
      .font(.body)
      .padding(.horizontal, 16)
      .frame(minHeight: 44)
      .background(IntelligencePalette.card, in: .capsule)
    }
    .buttonStyle(PressableCardStyle())
    .accessibilityLabel("Search, \(browse.query)")
    .accessibilityHint("Edits the search")
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, 8)
  }

  private var builtHeader: some View {
    VStack(alignment: .leading, spacing: 16) {
      if !page.heroImages.isEmpty {
        HeroGallery(images: page.heroImages)
          .transition(.opacity)
      }
      if !page.title.isEmpty {
        Text(page.title)
          .font(.title2.weight(.bold))
          .fontDesign(.rounded)
          .foregroundStyle(IntelligencePalette.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
          .blurReveal(isEnabled: animatesBuild)
      }
    }
    .padding(.horizontal, Spacing.page)
    .padding(.top, 8)
    .padding(.bottom, 16)
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
        EmptyView()
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
        .fixedSize(horizontal: false, vertical: true)
        .transition(.opacity)
    }
    ForEach(page.sections) { section in
      VStack(alignment: .leading, spacing: 14) {
        if !section.heading.isEmpty {
          SectionHeading(section.heading)
        }
        ForEach(section.bullets) { bullet in
          BulletRow(bullet: bullet, sources: page.sources)
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

    if browse.phase == .done {
      if !page.followUps.isEmpty {
        DiveDeeperSection(questions: page.followUps, onAsk: actions.ask)
      }
      if !page.sources.isEmpty {
        SourcesSection(
          title: BrowseCopy.sources, links: page.sources.map { ($0.url, $0.title) }, onOpen: actions.open)
      }
    }
  }

  private func openSettings() {
    if let url = URL(string: UIApplication.openSettingsURLString) {
      openURL(url)
    }
  }
}

#Preview("Building") {
  let intelligence = Intelligence.demo()
  let browse = intelligence.browse("things to do in joshua tree")
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

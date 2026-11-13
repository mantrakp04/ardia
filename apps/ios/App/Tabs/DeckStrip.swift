import ArdiaBrowser
import ArdiaDesign
import SwiftUI

enum DeckPhase: Equatable {
  case opening(UUID?)
  case settled
  case closing(UUID)
}

enum DragAxis {
  case horizontal
  case vertical(UUID)
}

struct DeckStrip: View {
  let geometry: TabsDeckGeometry
  let tabs: [BrowserTab]
  @Binding var isExpanding: Bool
  let onInteraction: () -> Void

  @Environment(AppModel.self) var app
  @Environment(\.accessibilityReduceMotion) var reduceMotion

  @State var order: [UUID] = []
  @State var scroll: Double = 0
  @State var dragScroll: Double?
  @State var settleOrigin: Double?
  @State var dragStart: Double = 0
  @State var axis: DragAxis?
  @State var phase: DeckPhase = .settled
  @State var scaleProgress: Double = 1
  @State var positionProgress: Double = 1
  @State var cardsOpacity: Double = 1
  @State var cover: Image?
  @State var coverOpacity: Double = 0
  @State var lifts: [UUID: Double] = [:]
  @State var vanishing: Set<UUID> = []
  @State var poofs: [PoofBurst.Spec] = []
  @State var focusTicks = 0
  @State var tickedCard: Int?
  @State var flickTicks = 0
  @State var copyTicks = 0
  @State var didAppear = false

  static let overlayLayer = 1_000_000.0

  var currentScroll: Double { dragScroll ?? scroll }

  var body: some View {
    let byID = Dictionary(tabs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    ZStack {
      Color.clear
        .contentShape(.rect)
        .gesture(deckDrag(for: nil))
      cards(byID)
      ForEach(poofs) { spec in
        PoofBurst(spec: spec)
      }
      .zIndex(Self.overlayLayer)
    }
    .overlay {
      if let cover {
        DeckCover(image: cover)
          .opacity(coverOpacity)
          .allowsHitTesting(false)
      }
    }
    .sensoryFeedback(.selection, trigger: focusTicks)
    .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: flickTicks)
    .sensoryFeedback(.success, trigger: copyTicks)
    .allowsHitTesting(!isOpeningTab)
    .onAppear(perform: appear)
    .onChange(of: phase, initial: true) { _, phase in isExpanding = phase != .settled }
    .onChange(of: tabs.map(\.id)) { reconcile(animated: true) }
    .onChange(of: app.deck.command) { _, command in
      guard let command else { return }
      perform(command.kind)
    }
    .accessibilityElement(children: .contain)
    .accessibilityScrollAction { edge in
      switch edge {
      case .leading: settle(to: Int(scroll.rounded()) - 1)
      case .trailing: settle(to: Int(scroll.rounded()) + 1)
      default: break
      }
    }
  }

  private var isOpeningTab: Bool {
    if case .closing = phase { return true }
    return false
  }

  @ViewBuilder
  private func cards(_ byID: [UUID: BrowserTab]) -> some View {
    let range = renderedRange
    ForEach(Array(order[range].enumerated()), id: \.element) { offset, id in
      if let tab = byID[id] {
        let index = range.lowerBound + offset
        let role = role(for: id, at: index)
        let motion = motion(for: id, at: index)
        let isLast = index == order.count - 1
        DeckCardHeader(tab: tab, isIncognito: tab.isPrivate)
          .modifier(DeckHeaderPlacement(motion: motion, role: role, geometry: geometry, isLast: isLast))
          .transition(.identity)
          .opacity(cardsOpacity)
          .zIndex(Double(index) * 2 + 1 + (role == .expanded ? 100_000 : 0))
          .allowsHitTesting(false)
        DeckCard(
          tab: tab,
          memoryImage: app.deck.memoryImage(for: id),
          snapshots: app.web.snapshots,
          menu: { CardMenu(tab: tab, close: { close(id, animated: true) }, copied: { copyTicks += 1 }) }
        )
        .modifier(DeckCardPlacement(motion: motion, role: role, geometry: geometry, isLast: isLast))
        .transition(.identity)
        .opacity(cardsOpacity)
        .zIndex(Double(index) * 2 + (role == .expanded ? 100_000 : 0))
        .onTapGesture { open(id) }
        .gesture(deckDrag(for: id))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(TabText.title(for: tab))
        .accessibilityValue(tab.isPrivate ? String(localized: "Incognito, \(TabText.host(for: tab))") : TabText.host(for: tab))
        .accessibilityHint("Opens the tab.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { open(id) }
        .accessibilityAction(named: "Close Tab") { close(id, animated: false) }
      }
    }
  }

  private func role(for id: UUID, at index: Int) -> DeckRole {
    switch phase {
    case .settled:
      return .stay
    case .opening(let expanded):
      guard let expanded, let expandedIndex = order.firstIndex(of: expanded) else { return .stay }
      if id == expanded { return .expanded }
      return index < expandedIndex ? .launcher : .slideRight
    case .closing(let expanded):
      guard let expandedIndex = order.firstIndex(of: expanded) else { return .stay }
      if id == expanded { return .expanded }
      return index < expandedIndex ? .slideLeft : .slideRight
    }
  }

  private func motion(for id: UUID, at index: Int) -> DeckMotion {
    DeckMotion(
      relative: Double(index) - currentScroll,
      scaleProgress: scaleProgress,
      positionProgress: positionProgress,
      lift: lifts[id] ?? 0,
      vanish: vanishing.contains(id) ? 1 : 0
    )
  }

  private func appear() {
    guard !didAppear else { return }
    didAppear = true
    order = tabs.map(\.id)
    let entrance = app.deck.entrance
    app.deck.entrance = .plain
    let selectedIndex = app.tabs.selectedTabID.flatMap { order.firstIndex(of: $0) }
    if case .fromPage(let id) = entrance, let index = order.firstIndex(of: id), !reduceMotion {
      scroll = Double(max(0, min(index - 1, order.count - 1)))
      if index < order.count - 1 { scroll = Double(index) }
      phase = .opening(id)
      scaleProgress = 0
      positionProgress = 0
      Task { @MainActor in
        withAnimation(TabsMotion.openScale) { scaleProgress = 1 }
        withAnimation(TabsMotion.openPosition, completionCriteria: .removed) {
          positionProgress = 1
        } completion: {
          phase = .settled
        }
      }
    } else {
      scroll = Double(selectedIndex.map { $0 < order.count - 1 ? $0 : max(0, $0 - 1) } ?? max(0, order.count - 2))
      if case .fromPage = entrance, let handoff = app.deck.handoff {
        if let index = order.firstIndex(of: handoff.tabID) { scroll = Double(max(0, index - 1)) }
        cover = Image(uiImage: handoff.image)
        coverOpacity = 1
        withAnimation(TabsMotion.fade) { coverOpacity = 0 } completion: { cover = nil }
      } else {
        cardsOpacity = 0
        withAnimation(TabsMotion.fade) { cardsOpacity = 1 }
      }
      phase = .settled
    }
  }

  private func reconcile(animated: Bool) {
    let current = tabs.map(\.id)
    let focused = order.isEmpty ? nil : order[min(max(Int(scroll.rounded()), 0), order.count - 1)]
    guard current != order else { return }
    let update = {
      order = current
      if let focused, let index = current.firstIndex(of: focused) {
        scroll = Double(index)
      } else {
        scroll = min(scroll, Double(max(current.count - 1, 0)))
      }
    }
    if animated, !reduceMotion {
      withAnimation(TabsMotion.gapClose, update)
    } else {
      update()
    }
  }

  private func perform(_ command: TabDeckModel.Command.Kind) {
    let focused = order.isEmpty ? nil : order[min(max(Int(scroll.rounded()), 0), order.count - 1)]
    switch command {
    case .scroll(let target): settle(to: target)
    case .closeFocused: if let focused { close(focused, animated: true) }
    case .openFocused: if let focused { open(focused) }
    case .lift(let amount): if let focused { lifts[focused] = amount }
    case .showArchiveCard: break
    }
  }

  private var renderedRange: Range<Int> {
    let current = TabsDeckGeometry.renderedRange(around: currentScroll, count: order.count)
    guard let settleOrigin else { return current }
    let origin = TabsDeckGeometry.renderedRange(around: settleOrigin, count: order.count)
    guard !origin.isEmpty, !current.isEmpty else { return current }
    return min(origin.lowerBound, current.lowerBound)..<max(origin.upperBound, current.upperBound)
  }
}

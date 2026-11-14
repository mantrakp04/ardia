import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import Combine
import SwiftUI

struct TabSwitcherView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.screenLayout) private var screenLayout

  var body: some View {
    GeometryReader { proxy in
      let full = CGSize(
        width: proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing,
        height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
      )
      let column = screenLayout.column
      let geometry = TabsDeckGeometry(
        container: CGSize(width: column?.contentWidth(in: full.width) ?? full.width, height: full.height),
        safeTop: proxy.safeAreaInsets.top,
        safeBottom: proxy.safeAreaInsets.bottom,
        safeSide: column == nil ? max(proxy.safeAreaInsets.leading, proxy.safeAreaInsets.trailing) : 0
      )
      TabDeck(base: geometry, column: column, fullSize: full)
        .frame(width: geometry.container.width, height: full.height)
        .frame(width: full.width, height: full.height, alignment: column?.edge == .leading ? .trailing : .leading)
        .ignoresSafeArea()
    }
    .ignoresSafeArea(.keyboard)
  }
}

private enum DeckPhase: Equatable {
  case opening(UUID?)
  case settled
  case closing(UUID)
}

private enum DragAxis {
  case horizontal
  case vertical(UUID)
}

struct TabDeck: View {
  let base: TabsDeckGeometry
  var column: ScreenLayout.SideColumn?
  var fullSize: CGSize = .zero

  @Environment(AppModel.self) private var app
  @Environment(\.profileLook) private var look
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var order: [UUID] = []
  @State private var scroll: Double = 0
  @State private var dragScroll: Double?
  @State private var settleOrigin: Double?
  @State private var dragStart: Double = 0
  @State private var axis: DragAxis?
  @State private var phase: DeckPhase = .settled
  @State private var scaleProgress: Double = 1
  @State private var positionProgress: Double = 1
  @State private var cardsOpacity: Double = 1
  @State private var cover: Image?
  @State private var coverOpacity: Double = 0
  @State private var lifts: [UUID: Double] = [:]
  @State private var vanishing: Set<UUID> = []
  @State private var poofs: [PoofBurst.Spec] = []
  @State private var isShowingArchiveCard = false
  @State private var isConfirmingCloseAll = false
  @State private var isConfirmingCloseIncognito = false
  @State private var focusTicks = 0
  @State private var tickedCard: Int?
  @State private var flickTicks = 0
  @State private var clearTicks = 0
  @State private var copyTicks = 0
  @State private var didAppear = false
  @State private var query = ""
  @State private var shownSpace: String?
  @State private var keyboardOverlap: CGFloat = 0
  @FocusState private var isSearchFocused: Bool

  private static let overlayLayer = 1_000_000.0

  private var currentScroll: Double { dragScroll ?? scroll }

  private var isOpeningTab: Bool {
    if case .closing = phase { return true }
    return false
  }

  private var geometry: TabsDeckGeometry {
    let chrome = isShowingArchiveCard && !app.deck.isGrid ? TabsLayout.archiveCardBottom : TabsLayout.headerBottom
    return TabsDeckGeometry(
      container: base.container,
      safeTop: base.safeTop,
      safeBottom: base.safeBottom,
      safeSide: base.safeSide,
      chromeBottom: base.safeTop + chrome
    )
  }

  private var trimmedQuery: String {
    query.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var sourceOrder: [UUID] {
    let needle = trimmedQuery
    let ordered = app.deckOrder
    guard !needle.isEmpty else { return ordered.map(\.id) }
    return ordered.filter { TabText.matches($0, needle) }.map(\.id)
  }

  private var tabsByID: [UUID: BrowserTab] {
    Dictionary(app.deckTabs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
  }

  var body: some View {
    let byID = tabsByID
    let geometry = geometry
    ZStack {
      TabsBackdrop(look: look)
        .frame(width: column == nil ? nil : fullSize.width)
        .frame(width: geometry.container.width, alignment: column?.edge == .leading ? .trailing : .leading)
        .opacity(backdropOpacity)
        .contentShape(.rect)
        .onTapGesture { isSearchFocused = false }
        .gesture(deckDrag(for: nil))
      if app.deck.isGrid {
        grid(byID, geometry: geometry)
          .opacity(chromeOpacity)
      } else if column != nil {
        ZStack { cards(byID) }
          .frame(width: geometry.container.width, height: geometry.container.height)
          .clipped()
      } else {
        cards(byID)
      }
      if order.isEmpty, phase == .settled {
        DeckEmptyState(geometry: geometry, isSearching: !trimmedQuery.isEmpty, showsArchive: app.hasArchivedTabs) { app.openArchive() }
          .transition(.opacity)
          .zIndex(Self.overlayLayer)
      }
      ForEach(poofs) { spec in
        PoofBurst(spec: spec)
      }
      .zIndex(Self.overlayLayer)
      if isShowingArchiveCard, !app.deck.isGrid {
        ArchiveIntervalCard(interval: Bindable(app.tabs).autoArchiveInterval) {
          dismissArchiveCard()
        }
        .padding(.horizontal, geometry.safeSide + TabsLayout.headerSide)
        .frame(width: geometry.container.width)
        .position(x: geometry.container.width / 2, y: geometry.safeTop + TabsLayout.archiveCardCenter)
        .opacity(lifts.isEmpty ? chromeOpacity : 0)
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96)))
        .zIndex(Self.overlayLayer + 1)
      }
      DeckHeader(
        geometry: geometry,
        privateCount: app.tabs.privateTabs.count,
        hasTabs: !app.deckTabs.isEmpty,
        closeIncognito: { isConfirmingCloseIncognito = true },
        closeAll: { isConfirmingCloseAll = true }
      )
      .opacity(chromeOpacity)
      .zIndex(Self.overlayLayer + 2)
      if let column {
        DeckColumn(
          column: column,
          size: fullSize,
          isGrid: app.deck.isGrid,
          query: $query,
          searchFocus: $isSearchFocused,
          plus: deckPlusActions,
          toggleGrid: toggleGrid,
          closeAll: { isConfirmingCloseAll = true }
        )
        .frame(width: fullSize.width, height: fullSize.height)
        .position(x: fullSize.width / 2 + (column.edge == .leading ? geometry.container.width - fullSize.width : 0), y: fullSize.height / 2)
        .opacity(chromeOpacity)
        .zIndex(Self.overlayLayer + 3)
      } else {
        DeckBottomBar(
          geometry: geometry,
          isGrid: app.deck.isGrid,
          query: $query,
          searchFocus: $isSearchFocused,
          plus: deckPlusActions,
          toggleGrid: toggleGrid
        )
        .frame(width: geometry.container.width)
        .position(x: geometry.container.width / 2, y: barCenterY(geometry))
        .opacity(chromeOpacity)
        .zIndex(Self.overlayLayer + 3)
      }
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
    .sensoryFeedback(.impact(weight: .medium), trigger: clearTicks)
    .sensoryFeedback(.success, trigger: copyTicks)
    .sensoryFeedback(.selection, trigger: shownSpace)
    .confirmationDialog(closeAllTitle, isPresented: $isConfirmingCloseAll, titleVisibility: .visible) {
      Button(closeAllButton, role: .destructive) {
        clearTicks += 1
        closeAll()
      }
    } message: {
      Text(app.tabs.privateTabs.isEmpty ? "They’ll stay in your Archive." : "Incognito tabs aren’t saved. Other tabs stay in your Archive.")
    }
    .confirmationDialog("Close Incognito Tabs?", isPresented: $isConfirmingCloseIncognito, titleVisibility: .visible) {
      Button("Close Incognito Tabs", role: .destructive) {
        clearTicks += 1
        app.leaveIncognito()
      }
    } message: {
      Text("Their pages, cookies and history are cleared.")
    }
    .allowsHitTesting(!isOpeningTab)
    .onAppear(perform: appear)
    .onChange(of: app.deckTabs.map(\.id)) { reconcile(animated: true) }
    .onChange(of: app.currentSpace?.syncId) { reconcile(animated: true) }
    .onChange(of: trimmedQuery) { searchChanged() }
    .onChange(of: app.deck.command) { _, command in
      guard let command else { return }
      perform(command.kind)
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
      guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
      let overlap = max(0, base.container.height - frame.minY)
      withAnimation(.smooth(duration: 0.3)) { keyboardOverlap = overlap }
    }
    .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
      withAnimation(.smooth(duration: 0.3)) { keyboardOverlap = 0 }
    }
    .animation(reduceMotion ? nil : TabsMotion.expand, value: isShowingArchiveCard)
    .accessibilityElement(children: .contain)
    .accessibilityScrollAction { edge in
      switch edge {
      case .leading: settle(to: Int(scroll.rounded()) - 1)
      case .trailing: settle(to: Int(scroll.rounded()) + 1)
      default: break
      }
    }
  }

  private var deckPlusActions: PlusActions {
    PlusActions(
      isIncognito: app.isIncognito,
      canReopen: app.tabs.canReopenClosed,
      newTab: { app.newTab() },
      newRegularTab: { app.newRegularTab() },
      newIncognitoTab: { app.newIncognitoTab() },
      reopen: { app.reopenLastClosed() }
    )
  }

  private func barCenterY(_ geometry: TabsDeckGeometry) -> CGFloat {
    guard keyboardOverlap > 0 else { return geometry.barCenterY }
    return geometry.container.height - keyboardOverlap - TabsLayout.barGap - TabsLayout.barCircle / 2
  }

  private func grid(_ byID: [UUID: BrowserTab], geometry: TabsDeckGeometry) -> some View {
    TabGridView(
      tabs: order.compactMap { byID[$0] },
      selectedID: app.tabs.selectedTabID,
      cardAspect: geometry.container.width / max(geometry.container.height, 1),
      topInset: geometry.safeTop + TabsLayout.headerBottom + 8,
      bottomInset: geometry.container.height - geometry.barCenterY + TabsLayout.barCircle,
      sideInset: geometry.safeSide + TabsLayout.headerSide + 4,
      memoryImage: { app.deck.memoryImage(for: $0) },
      snapshots: app.web.snapshots,
      open: { id in
        isSearchFocused = false
        app.openTab(id)
      },
      close: { id in close(id, animated: false) }
    )
  }

  private func toggleGrid() {
    isSearchFocused = false
    withAnimation(reduceMotion ? TabsMotion.fade : TabsMotion.expand) { app.deck.isGrid.toggle() }
  }

  private func searchChanged() {
    let next = sourceOrder
    let update = {
      order = next
      scroll = Double(max(next.count - 1, 0))
    }
    if reduceMotion { update() } else { withAnimation(TabsMotion.gapClose, update) }
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

  private var backdropOpacity: Double {
    if case .opening(let id) = phase, id != nil { return min(1, positionProgress * 1.4) }
    if case .closing = phase { return min(1, positionProgress * 1.4) }
    return 1
  }

  private var chromeOpacity: Double {
    switch phase {
    case .settled: 1
    case .opening(let id): id == nil ? 1 : max(0, (positionProgress - 0.6) / 0.4)
    case .closing: max(0, (positionProgress - 0.6) / 0.4)
    }
  }

  private var closeAllTitle: String {
    order.count == 1 ? String(localized: "Close 1 Tab?") : String(localized: "Close \(order.count) Tabs?")
  }

  private var closeAllButton: String {
    order.count == 1 ? String(localized: "Close Tab") : String(localized: "Close All Tabs")
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
    order = sourceOrder
    shownSpace = app.currentSpace?.syncId
    isShowingArchiveCard = app.deck.shouldOfferArchiveCard(openTabs: app.deckTabs.count)
    let entrance = app.deck.entrance
    app.deck.entrance = .plain
    if case .fromPage(let id) = entrance, let index = order.firstIndex(of: id), !reduceMotion, !app.deck.isGrid {
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
      scroll = Double(max(0, order.count - 2))
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
    let space = app.currentSpace?.syncId
    if space != shownSpace {
      shownSpace = space
      showNewSpace()
      return
    }
    let current = sourceOrder
    let live = Set(current)
    let focused = order.isEmpty ? nil : order[min(max(Int(scroll.rounded()), 0), order.count - 1)]
    var next = order.filter { live.contains($0) }
    let known = Set(next)
    next.append(contentsOf: current.filter { !known.contains($0) })
    guard next != order else { return }
    let update = {
      order = next
      if let focused, let index = next.firstIndex(of: focused) {
        scroll = Double(index)
      } else {
        scroll = min(scroll, Double(max(next.count - 1, 0)))
      }
    }
    if animated, !reduceMotion {
      withAnimation(TabsMotion.gapClose, update)
    } else {
      update()
    }
  }

  private func showNewSpace() {
    order = sourceOrder
    scroll = Double(max(0, order.count - 2))
    dragScroll = nil
    settleOrigin = nil
    lifts = [:]
    vanishing = []
    cardsOpacity = 0
    withAnimation(TabsMotion.fade) { cardsOpacity = 1 }
    if !isShowingArchiveCard { offerArchiveCard() }
  }

  private func offerArchiveCard(force: Bool = false) {
    guard force || app.deck.shouldOfferArchiveCard(openTabs: app.deckTabs.count) else { return }
    if reduceMotion {
      isShowingArchiveCard = true
    } else {
      withAnimation(TabsMotion.fade) { isShowingArchiveCard = true }
    }
  }

  private func dismissArchiveCard() {
    guard isShowingArchiveCard else { return }
    app.deck.hasShownArchiveCard = true
    isShowingArchiveCard = false
  }

  private func open(_ id: UUID) {
    guard phase == .settled, lifts[id] == nil else { return }
    isSearchFocused = false
    if reduceMotion {
      crossfadeOpen(id)
      return
    }
    phase = .closing(id)
    app.prepareToOpen(id)
    Task { @MainActor in
      await app.primeCover(for: id)
      if case .closing(id) = phase { app.beginOpening(id) }
    }
    withAnimation(TabsMotion.expand, completionCriteria: .removed) {
      scaleProgress = 0
      positionProgress = 0
    } completion: {
      app.openTab(id)
    }
  }

  private func crossfadeOpen(_ id: UUID) {
    app.prepareToOpen(id)
    phase = .closing(id)
    Task { @MainActor in
      await app.primeCover(for: id)
      app.beginOpening(id)
      if let memory = app.deck.memoryImage(for: id) {
        cover = Image(uiImage: memory)
      } else if let name = app.tabs.tab(id)?.snapshotFileName, let image = await app.web.snapshots.image(named: name) {
        cover = Image(decorative: image, scale: 1)
      } else {
        app.openTab(id)
        return
      }
      coverOpacity = 0
      withAnimation(TabsMotion.fade) { coverOpacity = 1 } completion: { app.openTab(id) }
    }
  }

  private func close(_ id: UUID, animated: Bool) {
    guard let index = order.firstIndex(of: id) else { return }
    let remove = {
      guard let index = order.firstIndex(of: id) else {
        lifts[id] = nil
        vanishing.remove(id)
        return
      }
      let remaining = order.count - 1
      let focus = TabsDeckGeometry.scrollAfterRemoving(index: index, scroll: Int(scroll.rounded()), remaining: remaining)
      let update = {
        order.remove(at: index)
        scroll = Double(focus)
      }
      if reduceMotion { withAnimation(TabsMotion.fade, update) } else { withAnimation(TabsMotion.gapClose, update) }
      app.closeTab(id)
      Task { @MainActor in
        try? await Task.sleep(for: .seconds(0.6))
        lifts[id] = nil
        vanishing.remove(id)
      }
    }
    guard animated, !reduceMotion else {
      remove()
      return
    }
    let relative = Double(index) - currentScroll
    let center = geometry.center(at: relative)
    let lift = (lifts[id] ?? 0) - Double(geometry.cardSize.height) * 0.18
    let spec = PoofBurst.Spec(center: CGPoint(x: center.x, y: center.y + CGFloat(lift)), size: geometry.cardSize.width * 0.9)
    poofs.append(spec)
    withAnimation(.easeOut(duration: TabsMotion.flyAway)) {
      lifts[id] = lift
      vanishing.insert(id)
    }
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(TabsMotion.flyAway * 0.6))
      remove()
    }
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(TabsMotion.poofDuration + 0.05))
      poofs.removeAll { $0.id == spec.id }
    }
  }

  private func perform(_ command: TabDeckModel.Command.Kind) {
    let focused = order.isEmpty ? nil : order[min(max(Int(scroll.rounded()), 0), order.count - 1)]
    switch command {
    case .scroll(let target): settle(to: target)
    case .closeFocused: if let focused { close(focused, animated: true) }
    case .openFocused: if let focused { open(focused) }
    case .showArchiveCard: offerArchiveCard(force: true)
    case .lift(let amount): if let focused { lifts[focused] = amount }
    }
  }

  private func closeAll() {
    app.closeAllTabs()
  }

  private var renderedRange: Range<Int> {
    let current = TabsDeckGeometry.renderedRange(around: currentScroll, count: order.count)
    guard let settleOrigin else { return current }
    let origin = TabsDeckGeometry.renderedRange(around: settleOrigin, count: order.count)
    guard !origin.isEmpty, !current.isEmpty else { return current }
    return min(origin.lowerBound, current.lowerBound)..<max(origin.upperBound, current.upperBound)
  }

  private func settle(to target: Int, velocity: Double = 0) {
    let clamped = min(max(target, 0), max(order.count - 1, 0))
    let from = currentScroll
    dragScroll = nil
    scroll = from
    settleOrigin = from
    let animation = reduceMotion ? TabsMotion.fade : TabsMotion.settle(distance: Double(clamped) - from, velocity: velocity)
    withAnimation(animation) {
      scroll = Double(clamped)
    } completion: {
      if scroll == Double(clamped) { settleOrigin = nil }
    }
  }

  private func focusedCard(at scroll: Double) -> Int {
    min(max(Int(scroll.rounded()), 0), max(order.count - 1, 0))
  }

  private func tickIfFocusChanged(to card: Int) {
    guard let tickedCard, tickedCard != card else { return }
    self.tickedCard = card
    focusTicks += 1
  }

  private func deckDrag(for id: UUID?) -> some Gesture {
    DragGesture(minimumDistance: 10)
      .onChanged { value in
        guard phase == .settled else { return }
        if axis == nil {
          let dx = value.translation.width
          let dy = value.translation.height
          if let id, abs(dy) > abs(dx), dy < 0 {
            axis = .vertical(id)
          } else {
            axis = .horizontal
            dragStart = currentScroll
            tickedCard = focusedCard(at: currentScroll)
          }
              }
        switch axis {
        case .horizontal:
          let raw = dragStart + geometry.scrollDelta(forDrag: value.translation.width)
          let banded = TabsDeckGeometry.rubberBand(raw, count: order.count)
          var transaction = Transaction()
          transaction.disablesAnimations = true
          withTransaction(transaction) {
            dragScroll = banded
          }
          tickIfFocusChanged(to: focusedCard(at: banded))
        case .vertical(let card):
          let dy = value.translation.height
          var transaction = Transaction()
          transaction.disablesAnimations = true
          withTransaction(transaction) {
            lifts[card] = dy < 0 ? dy : dy * 0.12
          }
        case nil:
          break
        }
      }
      .onEnded { value in
        defer { axis = nil }
        switch axis {
        case .horizontal:
          let velocity = value.velocity.width
          let target = geometry.settleTarget(from: currentScroll, velocity: velocity, count: order.count)
          tickIfFocusChanged(to: target)
          tickedCard = nil
          settle(to: target, velocity: geometry.scrollDelta(forDrag: velocity))
        case .vertical(let card):
          if TabsDeckGeometry.shouldClose(translation: value.translation.height, velocity: value.velocity.height, cardHeight: geometry.cardSize.height) {
            flickTicks += 1
            close(card, animated: true)
          } else {
            withAnimation(TabsMotion.release) { lifts[card] = nil }
          }
        case nil:
          break
        }
      }
  }
}

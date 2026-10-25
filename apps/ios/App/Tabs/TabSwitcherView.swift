import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct TabSwitcherView: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    GeometryReader { proxy in
      let geometry = TabsDeckGeometry(
        container: CGSize(
          width: proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing,
          height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
        ),
        safeTop: proxy.safeAreaInsets.top,
        safeBottom: proxy.safeAreaInsets.bottom,
        safeSide: max(proxy.safeAreaInsets.leading, proxy.safeAreaInsets.trailing)
      )
      TabDeck(geometry: geometry)
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
  let geometry: TabsDeckGeometry

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var order: [UUID] = []
  @State private var scroll: Double = 0
  @State private var dragScroll: Double?
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

  private static let overlayLayer = 1_000_000.0

  private var currentScroll: Double { dragScroll ?? scroll }

  private var tabsByID: [UUID: BrowserTab] {
    Dictionary(app.deckTabs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
  }

  var body: some View {
    let byID = tabsByID
    ZStack {
      TabsBackdrop(tint: profileTint)
        .opacity(backdropOpacity)
        .contentShape(.rect)
        .gesture(deckDrag(for: nil))
      cards(byID)
      if order.isEmpty, phase == .settled {
        DeckEmptyState(geometry: geometry, showsArchive: app.hasArchivedTabs) { app.openArchive() }
          .transition(.opacity)
          .zIndex(Self.overlayLayer)
      }
      ForEach(poofs) { spec in
        PoofBurst(spec: spec)
      }
      .zIndex(Self.overlayLayer)
      if !app.tabs.privateTabs.isEmpty {
        IncognitoChip(count: app.tabs.privateTabs.count) { isConfirmingCloseIncognito = true }
          .position(x: geometry.container.width / 2, y: geometry.safeTop + 22)
          .opacity(lifts.isEmpty ? chromeOpacity : 0)
          .zIndex(Self.overlayLayer)
      }
      if isShowingArchiveCard {
        ArchiveIntervalCard(interval: Bindable(app.tabs).autoArchiveInterval) {
          hideArchiveCard()
        }
        .padding(.horizontal, Spacing.page)
        .position(x: geometry.container.width / 2, y: geometry.cardCenterY + geometry.cardSize.height * 0.22)
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96)))
        .zIndex(Self.overlayLayer + 1)
      }
      TabDeckBar(
        geometry: geometry,
        isIncognito: app.isIncognito,
        showsSyncedTabs: app.sync.isEnabled,
        canReopen: app.tabs.canReopenClosed,
        hasTabs: !order.isEmpty,
        newTab: { app.newTab() },
        newRegularTab: { app.newRegularTab() },
        newIncognitoTab: { app.newIncognitoTab() },
        reopen: { app.reopenLastClosed() },
        closeAll: { isConfirmingCloseAll = true },
        leading: { app.sync.isEnabled ? app.openSyncedSpaces() : app.openArchive() },
        settings: { app.sheet = .settings }
      )
      .opacity(chromeOpacity)
      .zIndex(Self.overlayLayer + 2)
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
    .onAppear(perform: appear)
    .onChange(of: app.deckTabs.map(\.id)) { reconcile(animated: true) }
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

  @ViewBuilder
  private func cards(_ byID: [UUID: BrowserTab]) -> some View {
    let range = TabsDeckGeometry.renderedRange(around: currentScroll, count: order.count)
    ForEach(Array(order[range].enumerated()), id: \.element) { offset, id in
      if let tab = byID[id] {
        let index = range.lowerBound + offset
        let role = role(for: id, at: index)
        let motion = motion(for: id, at: index)
        let isLast = index == order.count - 1
        DeckCardHeader(tab: tab, isIncognito: tab.isPrivate, showsTitle: geometry.visibleWidth(at: motion.relative, isLast: isLast) >= TabsDeckGeometry.headerFaviconOnlyWidth)
          .modifier(DeckHeaderPlacement(motion: motion, role: role, geometry: geometry, isLast: isLast))
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

  private var profileTint: [Color]? {
    guard app.sync.isEnabled, let theme = app.sync.selectedProfile?.theme else { return nil }
    let colors = theme.colors.compactMap { Color(hexString: $0) }
    return colors.count >= 2 ? colors : nil
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
    order = app.deckOrder.map(\.id)
    let entrance = app.deck.entrance
    app.deck.entrance = .plain
    if case .fromPage(let id) = entrance, let index = order.firstIndex(of: id), !reduceMotion {
      scroll = Double(max(0, min(index - 1, order.count - 1)))
      if index < order.count - 1 { scroll = Double(index) }
      phase = .opening(id)
      scaleProgress = 0
      positionProgress = 0
      Task { @MainActor in
        withAnimation(TabsMotion.openScale) { scaleProgress = 1 }
        withAnimation(TabsMotion.openPosition) {
          positionProgress = 1
        } completion: {
          phase = .settled
          offerArchiveCard()
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
      offerArchiveCard()
    }
  }

  private func reconcile(animated: Bool) {
    let current = app.deckOrder.map(\.id)
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

  private func offerArchiveCard(force: Bool = false) {
    guard force || app.deck.shouldOfferArchiveCard(openTabs: order.count) else { return }
    app.deck.hasShownArchiveCard = true
    withAnimation(TabsMotion.fade.delay(0.15)) { isShowingArchiveCard = true }
  }

  private func hideArchiveCard() {
    guard isShowingArchiveCard else { return }
    withAnimation(TabsMotion.fade) { isShowingArchiveCard = false }
  }

  private func open(_ id: UUID) {
    guard phase == .settled, lifts[id] == nil else { return }
    hideArchiveCard()
    if reduceMotion {
      crossfadeOpen(id)
      return
    }
    phase = .closing(id)
    app.prepareToOpen(id)
    withAnimation(TabsMotion.expand) {
      scaleProgress = 0
      positionProgress = 0
    } completion: {
      app.openTab(id)
    }
  }

  private func crossfadeOpen(_ id: UUID) {
    app.prepareToOpen(id)
    Task { @MainActor in
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
    hideArchiveCard()
    let remove = {
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
    hideArchiveCard()
    app.closeAllTabs()
  }

  private func settle(to target: Int, velocity: Double = 0) {
    let clamped = min(max(target, 0), max(order.count - 1, 0))
    let from = currentScroll
    dragScroll = nil
    scroll = from
    let animation = reduceMotion ? TabsMotion.fade : TabsMotion.settle(distance: Double(clamped) - from, velocity: velocity)
    withAnimation(animation) { scroll = Double(clamped) }
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
          hideArchiveCard()
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

struct DeckCard<Menu: View>: View {
  let tab: BrowserTab
  let memoryImage: UIImage?
  let snapshots: TabSnapshotStore
  @ViewBuilder let menu: () -> Menu

  var body: some View {
    TabCardContent(tab: tab, isIncognito: tab.isPrivate, memoryImage: memoryImage, snapshots: snapshots)
      .overlay(alignment: .topLeading) {
        if TabText.isUnseenReceived(tab) {
          ReceivedBadge().padding(10)
        }
      }
      .contextMenu { menu() }
  }
}

struct DeckCardHeader: View {
  let tab: BrowserTab
  let isIncognito: Bool
  let showsTitle: Bool

  var body: some View {
    HStack(spacing: TabsLayout.headerSpacing) {
      if isIncognito {
        IncognitoGlyph(size: TabsLayout.faviconSize)
          .padding(2)
          .background(TabsPalette.incognitoCardRaised, in: .rect(cornerRadius: TabsLayout.faviconRadius))
      } else {
        FaviconImage(iconURL: tab.faviconURL, pageURL: tab.url, size: TabsLayout.faviconSize)
      }
      if showsTitle {
        Text(TabText.title(for: tab))
          .font(.caption)
          .foregroundStyle(TabsPalette.headerText)
          .lineLimit(1)
          .truncationMode(.tail)
          .dynamicTypeSize(...DynamicTypeSize.accessibility1)
      }
    }
    .frame(maxWidth: .infinity)
  }
}

struct CardMenu: View {
  let tab: BrowserTab
  let close: () -> Void
  var copied: () -> Void = {}
  @Environment(AppModel.self) private var app

  var body: some View {
    if let url = app.shareURL(of: tab) {
      Button("Copy Link", systemImage: "link") {
        app.copyLink(of: tab)
        copied()
      }
      ShareLink(item: url, subject: Text(TabText.title(for: tab))) {
        Label("Share", systemImage: "square.and.arrow.up")
      }
      if !tab.isPrivate, app.canSendTabs {
        let devices = app.sync.devicesThatReceiveTabs
        if devices.count == 1, let device = devices.first {
          Button("Send to \(device.name)", systemImage: DeviceSymbol.name(for: device)) { app.send(tab, to: device) }
        } else {
          Menu("Send to Device", systemImage: "laptopcomputer.and.arrow.down") {
            ForEach(devices) { device in
              Button(device.name, systemImage: DeviceSymbol.name(for: device)) { app.send(tab, to: device) }
            }
          }
        }
      }
      if !tab.isPrivate, app.sync.isEnabled {
        Button("Pin to Mac", systemImage: "star") { app.pinToMac(tab) }
      }
      Divider()
    }
    Button("Close Tab", systemImage: "xmark", role: .destructive, action: close)
  }
}

enum DeviceSymbol {
  static func name(for device: SyncedDevice) -> String {
    switch device.kind {
    case .phone: "iphone"
    case .mac: device.name.localizedCaseInsensitiveContains("book") ? "laptopcomputer" : "desktopcomputer"
    }
  }

  static func name(forDeviceNamed name: String, kind: SyncedDevice.Kind) -> String {
    switch kind {
    case .phone: "iphone"
    case .mac: name.localizedCaseInsensitiveContains("book") ? "laptopcomputer" : "desktopcomputer"
    }
  }
}

struct IncognitoChip: View {
  let count: Int
  let close: () -> Void

  var body: some View {
    Menu {
      Button("Close Incognito Tabs", systemImage: "xmark", role: .destructive, action: close)
    } label: {
      HStack(spacing: 6) {
        IncognitoGlyph(size: 16)
        Text("Incognito")
          .font(.subheadline.weight(.semibold))
        Text(count, format: .number)
          .font(.subheadline.weight(.semibold).monospacedDigit())
          .foregroundStyle(.white.opacity(0.6))
      }
      .foregroundStyle(.white)
      .padding(.horizontal, 12)
      .frame(minHeight: 32)
      .background(TabsPalette.incognitoCard, in: .capsule)
      .frame(minHeight: 44)
      .contentShape(.capsule)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Incognito, \(count) tabs")
    .accessibilityHint("Shows the option to close incognito tabs.")
  }
}

struct DeckEmptyState: View {
  let geometry: TabsDeckGeometry
  let showsArchive: Bool
  let openArchive: () -> Void

  var body: some View {
    VStack(spacing: 6) {
      Text("No Open Tabs")
        .font(.title3.weight(.semibold))
        .foregroundStyle(TabsPalette.headerText)
      Text("Tabs you open appear here. Inactive tabs move to the Archive.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      if showsArchive {
        Button("Open Archive", action: openArchive)
          .font(.subheadline.weight(.semibold))
          .tint(Palette.indigo)
          .padding(.top, 6)
          .frame(minHeight: 44)
      }
    }
    .frame(maxWidth: 300)
    .padding(.horizontal, Spacing.large)
    .position(x: geometry.container.width / 2, y: geometry.cardCenterY)
  }
}

struct DeckCover: View {
  let image: Image

  var body: some View {
    image
      .resizable()
      .scaledToFit()
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .background(Color(.systemBackground))
      .ignoresSafeArea()
      .accessibilityHidden(true)
  }
}

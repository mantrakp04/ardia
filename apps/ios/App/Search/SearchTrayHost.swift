import ArdiaDesign
import SwiftUI

struct SearchTrayHost: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @ScaledMetric(relativeTo: .title3) private var fieldScale: CGFloat = 1
  @State private var shown: BrowseSession.SearchRequest?
  @State private var presentation = 0
  @State private var isFocused = false
  @State private var isClosing = false
  @State private var hasLanded = false
  @State private var keyboard = KeyboardTracker()
  @State private var keyboardHeight: CGFloat = 0
  @State private var dragOffset: CGFloat = 0
  @State private var isDragging = false
  @State private var heldLift: CGFloat?
  @State private var trayHeight: CGFloat = 0
  @State private var settleTask: Task<Void, Never>?
  @State private var landingTask: Task<Void, Never>?
  @State private var removalTask: Task<Void, Never>?

  static let keyboardThreshold: CGFloat = 120

  var body: some View {
    ZStack {
      keyboardProbe
      tray
    }
  }

  private var tray: some View {
    GeometryReader { proxy in
      let safeBottom = proxy.safeAreaInsets.bottom
      let keyboardUp = keyboardHeight > Self.keyboardThreshold
      let restsWithoutKeyboard = hasLanded && !keyboardUp && !isClosing
      let liveLift = restsWithoutKeyboard ? max(keyboardHeight, safeBottom) : keyboardHeight
      let isUp = keyboardUp || (!isClosing && hasLanded)
      let lift = heldLift ?? liveLift
      let maxHeight = maxHeight(in: proxy, lift: lift)
      let progress = TrayDrag.progress(offset: dragOffset, travel: trayHeight + lift)
      ZStack(alignment: .bottom) {
        if let shown {
          dim
            .opacity(isUp ? 1 - progress : 0)
            .allowsHitTesting(isUp && !isClosing)
            .ignoresSafeArea()
          SearchTray(request: shown, isFocused: $isFocused, maxHeight: maxHeight, dismissDrag: dismissDrag(lift: liveLift))
            .id(presentation)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { trayHeight = $0 }
            .offset(y: safeBottom - lift + dragOffset)
            .opacity(isUp ? 1 : 0)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .allowsHitTesting(!isClosing)
            .accessibilityAddTraits(.isModal)
        }
      }
      .onChange(of: liveLift, initial: true) { _, live in
        guard shown != nil else { return }
        if live > Self.keyboardThreshold, !isClosing, !hasLanded {
          landingTask?.cancel()
          hasLanded = true
        }
        if !isDragging, let held = heldLift, abs(live - held) < 2 {
          heldLift = nil
        }
      }
    }
    .ignoresSafeArea(.keyboard)
    .onAppear { keyboard.start() }
    .task { await SearchSuggestionsModel.loadRecents(from: app.tabs) }
    .onChange(of: app.browse.search, initial: true) { _, request in
      if let request {
        present(request)
      } else if shown != nil {
        beginClosing()
      }
    }
  }

  private var keyboardProbe: some View {
    GeometryReader { proxy in
      Color.clear
        .onChange(of: proxy.safeAreaInsets.bottom, initial: true) { _, inset in
          let target = inset > Self.keyboardThreshold ? inset : 0
          guard target != keyboardHeight else { return }
          withAnimation(keyboard.animation) { keyboardHeight = target }
        }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private var dim: some View {
    Color.black
      .opacity(app.surface == .search ? 0.001 : BrowseLayout.trayDim)
      .contentShape(.rect)
      .onTapGesture { app.cancelSearch() }
      .accessibilityLabel("Close Search")
      .accessibilityAddTraits(.isButton)
  }

  private func maxHeight(in proxy: GeometryProxy, lift: CGFloat) -> CGFloat {
    let preferred = BrowseLayout.sheetAboveKeyboard + BrowseLayout.searchFieldHeight * (fieldScale - 1)
    let available = proxy.size.height + proxy.safeAreaInsets.bottom - lift - Spacing.tight
    return max(min(preferred, available), 0)
  }

  private func present(_ request: BrowseSession.SearchRequest) {
    removalTask?.cancel()
    settleTask?.cancel()
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      if shown == nil || isClosing { presentation += 1 }
      shown = request
      isClosing = false
      hasLanded = keyboardHeight > Self.keyboardThreshold
      dragOffset = 0
      heldLift = nil
      isDragging = false
    }
    app.browse.trayHoldsKeyboard = true
    landingTask?.cancel()
    landingTask = Task {
      try? await Task.sleep(for: .milliseconds(450))
      guard !Task.isCancelled, shown != nil, !isClosing, !hasLanded else { return }
      withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.searchRise) { hasLanded = true }
    }
  }

  private func refreshRecents() {
    let tabs = app.tabs
    Task {
      await SearchSuggestionsModel.loadRecents(from: tabs)
      try? await Task.sleep(for: .seconds(3))
      guard shown == nil else { return }
      await SearchSuggestionsModel.loadRecents(from: tabs)
    }
  }

  private func beginClosing() {
    guard !isClosing else { return }
    landingTask?.cancel()
    settleTask?.cancel()
    isFocused = false
    if keyboardHeight > Self.keyboardThreshold, heldLift == nil {
      isClosing = true
    } else {
      let travel = trayHeight + (heldLift ?? 0) + BrowseLayout.sheetTopRadius
      withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.trayDismiss) {
        isClosing = true
        if heldLift != nil, !reduceMotion { dragOffset = max(dragOffset, travel) }
      }
    }
    removalTask?.cancel()
    removalTask = Task {
      for _ in 0..<20 where keyboardHeight > Self.keyboardThreshold {
        try? await Task.sleep(for: .milliseconds(50))
      }
      try? await Task.sleep(for: .milliseconds(450))
      guard !Task.isCancelled, isClosing else { return }
      finish()
      refreshRecents()
    }
  }

  private func finish() {
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      shown = nil
      isClosing = false
      hasLanded = false
      dragOffset = 0
      heldLift = nil
      isDragging = false
    }
    app.browse.trayHoldsKeyboard = false
  }

  private func dismissDrag(lift: CGFloat) -> some Gesture {
    DragGesture(minimumDistance: 6, coordinateSpace: .global)
      .onChanged { value in
        guard !isClosing else { return }
        let translation = value.translation.height
        if !isDragging {
          isDragging = true
          settleTask?.cancel()
        }
        if TrayDrag.releasesKeyboard(translation: translation), isFocused {
          if heldLift == nil { heldLift = lift }
          isFocused = false
        }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { dragOffset = TrayDrag.offset(for: translation) }
      }
      .onEnded { value in
        guard isDragging else { return }
        isDragging = false
        if TrayDrag.shouldDismiss(translation: value.translation.height, velocity: value.velocity.height, trayHeight: trayHeight) {
          app.cancelSearch()
        } else {
          settle()
        }
      }
  }

  private func settle() {
    let wasHolding = heldLift != nil
    if wasHolding, !app.settings.isShowingOnboarding { isFocused = true }
    withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.traySettle) { dragOffset = 0 }
    guard wasHolding else { return }
    settleTask = Task {
      try? await Task.sleep(for: .milliseconds(650))
      guard !Task.isCancelled, !isDragging else { return }
      withAnimation(Motion.traySettle) { heldLift = nil }
    }
  }
}

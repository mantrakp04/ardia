import ArdiaDesign
import SwiftUI

struct SearchTrayHost: View {
  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @ScaledMetric(relativeTo: .title3) private var fieldScale: CGFloat = 1
  @State private var isFocused = false
  @State private var dragOffset: CGFloat = 0
  @State private var isDragging = false
  @State private var heldLift: CGFloat?
  @State private var trayHeight: CGFloat = 0
  @State private var releaseTask: Task<Void, Never>?

  var body: some View {
    GeometryReader { proxy in
      let liveLift = proxy.safeAreaInsets.bottom
      let lift = heldLift ?? liveLift
      let progress = TrayDrag.progress(offset: dragOffset, travel: trayHeight + lift)
      ZStack(alignment: .bottom) {
        if let request = app.browse.search {
          dim
            .opacity(1 - progress)
            .ignoresSafeArea()
            .transition(.opacity)
          SearchTray(request: request, isFocused: $isFocused, maxHeight: maxHeight(in: proxy, lift: lift), dismissDrag: dismissDrag(lift: liveLift))
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { trayHeight = $0 }
            .padding(.bottom, max(lift - liveLift, 0))
            .offset(y: dragOffset)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .transition(reduceMotion ? .opacity : .move(edge: .bottom))
            .accessibilityAddTraits(.isModal)
        }
      }
      .onChange(of: liveLift) { _, live in
        guard !isDragging, let held = heldLift, abs(live - held) < 2 else { return }
        heldLift = nil
      }
    }
    .animation(reduceMotion ? .easeOut(duration: 0.2) : Motion.searchRise, value: app.browse.search != nil)
    .onChange(of: app.browse.search != nil) { _, presented in
      if presented {
        reset()
        app.browse.trayHoldsKeyboard = true
      } else {
        releaseKeyboardHoldSoon()
      }
    }
  }

  private var dim: some View {
    Color.black
      .opacity(app.surface == .search ? 0.001 : BrowseLayout.trayDim)
      .contentShape(.rect)
      .onTapGesture(perform: close)
      .accessibilityLabel("Close Search")
      .accessibilityAddTraits(.isButton)
  }

  private func maxHeight(in proxy: GeometryProxy, lift: CGFloat) -> CGFloat {
    let preferred = BrowseLayout.sheetAboveKeyboard + BrowseLayout.searchFieldHeight * (fieldScale - 1)
    let available = proxy.size.height + proxy.safeAreaInsets.bottom - lift - Spacing.tight
    return max(min(preferred, available), 0)
  }

  private func dismissDrag(lift: CGFloat) -> some Gesture {
    DragGesture(minimumDistance: 6, coordinateSpace: .global)
      .onChanged { value in
        let translation = value.translation.height
        if !isDragging {
          isDragging = true
          releaseTask?.cancel()
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
        isDragging = false
        if TrayDrag.shouldDismiss(translation: value.translation.height, velocity: value.velocity.height, trayHeight: trayHeight) {
          close()
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
    releaseTask = Task {
      try? await Task.sleep(for: .milliseconds(650))
      guard !Task.isCancelled, !isDragging else { return }
      withAnimation(Motion.traySettle) { heldLift = nil }
    }
  }

  private func releaseKeyboardHoldSoon() {
    releaseTask?.cancel()
    releaseTask = Task {
      try? await Task.sleep(for: .milliseconds(700))
      guard !Task.isCancelled, app.browse.search == nil else { return }
      app.browse.trayHoldsKeyboard = false
    }
  }

  private func reset() {
    releaseTask?.cancel()
    var transaction = Transaction()
    transaction.disablesAnimations = true
    withTransaction(transaction) {
      dragOffset = 0
      heldLift = nil
      isDragging = false
    }
  }

  private func close() {
    withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.trayDismiss) { app.cancelSearch() }
  }
}

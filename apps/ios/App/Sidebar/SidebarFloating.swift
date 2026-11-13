import ArdiaDesign
import SwiftUI

struct SidebarOverlay: View {
  let frame: SidebarFrame

  @Environment(SidebarState.self) private var sidebar
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @GestureState private var isSwiping = false

  var body: some View {
    let progress = sidebar.peekDrag ?? 1
    ZStack(alignment: frame.alignment) {
      Rectangle()
        .fill(Tokens.Role.scrim)
        .opacity(progress)
        .contentShape(.rect)
        .onTapGesture { sidebar.dismissOverlay() }
        .accessibilityLabel(String(localized: "Close Sidebar"))
        .accessibilityAddTraits(.isButton)
        .transition(.opacity)
      SidebarColumn(width: frame.width, edge: frame.edge, showsPinned: true, showsToggle: true)
        .padding(.top, max(frame.safeTop - SidebarMetrics.cardInset, 0))
        .frame(width: frame.width)
        .background {
          ProfileBackdrop()
            .clipShape(RoundedRectangle(cornerRadius: frame.cardRadius, style: .continuous))
            .shadow(SidebarChrome.Overlay.slideShadow)
        }
        .padding(.vertical, SidebarMetrics.cardInset)
        .padding(frame.edge == .leading ? .leading : .trailing, SidebarMetrics.cardInset)
        .offset(x: reduceMotion ? 0 : -(1 - progress) * travel * outward)
        .opacity(reduceMotion ? progress : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(String(localized: "Sidebar"))
        .transition(reduceMotion ? .opacity : .move(edge: frame.slideEdge))
    }
    .simultaneousGesture(swipeBack)
    .onChange(of: isSwiping) { _, swiping in
      guard !swiping, sidebar.peekDrag != nil else { return }
      withAnimation(settle) { sidebar.peekDrag = nil }
    }
  }

  private var settle: Animation {
    reduceMotion ? .easeOut(duration: Tokens.Duration.base) : Tokens.Spring.sidebarPeek.animation
  }

  private var outward: CGFloat { frame.edge == .leading ? 1 : -1 }
  private var travel: CGFloat { frame.width + SidebarMetrics.cardInset }

  private var swipeBack: some Gesture {
    DragGesture(minimumDistance: SidebarPeek.dragSlop, coordinateSpace: .named(SidebarFrame.space))
      .updating($isSwiping) { _, swiping, _ in swiping = true }
      .onChanged { value in
        guard sidebar.peekDrag != nil || SidebarPeek.isSwipeBack(translation: value.translation, edge: frame.edge) else { return }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
          sidebar.peekDrag = SidebarPeek.openProgress(from: 1, translation: value.translation.width, width: travel, edge: frame.edge)
        }
      }
      .onEnded { value in
        guard let progress = sidebar.peekDrag else { return }
        let stays = SidebarPeek.settlesOpen(progress: progress, velocity: value.velocity.width, width: travel, edge: frame.edge)
        withAnimation(settle) {
          if !stays { sidebar.dismissOverlay() }
          sidebar.peekDrag = nil
        }
      }
  }
}

struct SidebarPeekPanel: View {
  let frame: SidebarFrame

  @Environment(SidebarState.self) private var sidebar
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    SidebarColumn(width: frame.width, edge: frame.edge, showsPinned: true, showsToggle: true)
      .padding(.top, max(frame.safeTop - SidebarMetrics.cardInset, 0))
      .frame(width: frame.width)
      .background {
        ProfileBackdrop()
          .clipShape(RoundedRectangle(cornerRadius: SidebarPeek.panelRadius(cardRadius: frame.cardRadius), style: .continuous))
          .shadow(Tokens.Shadow.peek)
      }
      .padding(.vertical, SidebarMetrics.cardInset)
      .padding(frame.edge == .leading ? .leading : .trailing, SidebarMetrics.cardInset)
      .onHover { inside in
        if inside { sidebar.holdPeek() } else { sidebar.releasePointerPeek() }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel(String(localized: "Sidebar"))
      .transition(transition)
  }

  private var transition: AnyTransition {
    if reduceMotion {
      return .opacity.animation(.easeOut(duration: Tokens.Duration.base))
    }
    return .asymmetric(
      insertion: .move(edge: frame.slideEdge).animation(Tokens.Spring.sidebarPeek.animation),
      removal: .move(edge: frame.slideEdge).animation(.easeInOut(duration: Tokens.Duration.sidebarPeekOut))
    )
  }
}

struct SidebarEdgePull: View {
  let frame: SidebarFrame
  let placement: SidebarPlacement

  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar
  @Environment(\.chromeLayout) private var layout
  @Environment(\.hingeState) private var hinge
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @GestureState private var isPulling = false

  var body: some View {
    Color.clear
      .frame(width: SidebarPeek.touchZone)
      .frame(maxHeight: .infinity)
      .contentShape(.rect)
      .gesture(pull, isEnabled: SidebarPeek.allowsPeek(placement: placement, isEnabled: app.settings.showsSidebarAtEdge) || sidebar.peekDrag != nil)
      .frame(maxWidth: .infinity, alignment: frame.alignment)
      .accessibilityHidden(true)
      .onChange(of: isPulling) { _, pulling in
        guard !pulling, sidebar.peekDrag != nil else { return }
        withAnimation(settle) { sidebar.peekDrag = nil }
      }
  }

  private var settle: Animation {
    reduceMotion ? .easeOut(duration: Tokens.Duration.base) : Tokens.Spring.sidebarPeek.animation
  }

  private var travel: CGFloat { frame.width + SidebarMetrics.cardInset }

  private var pull: some Gesture {
    DragGesture(minimumDistance: SidebarPeek.dragSlop, coordinateSpace: .named(SidebarFrame.space))
      .updating($isPulling) { _, pulling, _ in pulling = true }
      .onChanged { value in
        guard sidebar.peekDrag != nil || SidebarPeek.startsPeek(.touch, at: value.startLocation.x, windowWidth: frame.window.width, edge: frame.edge, placement: placement, isEnabled: app.settings.showsSidebarAtEdge) else { return }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
          sidebar.peekDrag = SidebarPeek.openProgress(from: 0, translation: value.translation.width, width: travel, edge: frame.edge)
        }
      }
      .onEnded { value in
        guard let progress = sidebar.peekDrag else { return }
        let opens = SidebarPeek.settlesOpen(progress: progress, velocity: value.velocity.width, width: travel, edge: frame.edge)
        withAnimation(settle) {
          if opens { sidebar.peek(.touch, layout: layout, hinge: hinge) }
          sidebar.peekDrag = nil
        }
      }
  }
}

struct SidebarPeekPointer: ViewModifier {
  let frame: SidebarFrame
  let placement: SidebarPlacement

  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar
  @Environment(\.chromeLayout) private var layout
  @Environment(\.hingeState) private var hinge

  func body(content: Content) -> some View {
    content.onContinuousHover(coordinateSpace: .local) { phase in
      switch phase {
      case .active(let location): track(location.x)
      case .ended:
        sidebar.cancelPointerReveal()
        sidebar.releasePointerPeek()
      }
    }
  }

  private func track(_ x: CGFloat) {
    if sidebar.peekDrag == nil, SidebarPeek.startsPeek(.pointer, at: x, windowWidth: frame.window.width, edge: frame.edge, placement: placement, isEnabled: app.settings.showsSidebarAtEdge) {
      sidebar.revealPointerPeek(layout: layout, hinge: hinge)
      return
    }
    let isPeeking = sidebar.visibility.peek == .pointer
    switch SidebarPeek.pointerZone(x: x, windowWidth: frame.window.width, edge: frame.edge, sidebarWidth: frame.width, isPeeking: isPeeking) {
    case .reveal, .hold:
      sidebar.holdPeek()
    case .outside:
      sidebar.cancelPointerReveal()
      sidebar.releasePointerPeek()
    }
  }
}

import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SidebarShell: View {
  @Environment(AppModel.self) private var app
  @Environment(SidebarState.self) private var sidebar
  @Environment(\.chromeLayout) private var layout
  @Environment(\.hingeState) private var hinge
  @Environment(\.windowCornerRadii) private var windowCorners
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  init() {
    SiteVersion.current = .desktop
  }

  var body: some View {
    let placement = sidebar.visibility.placement(layout: layout, hinge: hinge)
    GeometryReader { proxy in
      let frame = SidebarFrame(proxy: proxy, width: sidebar.shownWidth, edge: edge, cardRadius: SidebarChrome.cardRadius(windowCorners: windowCorners))
      ZStack {
        ProfileBackdrop()
        SidebarArrangement(placement: placement, frame: frame)
        if SidebarPeek.allowsPeek(placement: placement, isEnabled: app.settings.showsSidebarAtEdge) || sidebar.peekDrag != nil {
          SidebarEdgePull(frame: frame, placement: placement)
        }
        if (placement == .overlay || placement == .peek) && app.browse.search == nil {
          Button(String(localized: "Close Sidebar")) {
            sidebar.dismissOverlay()
            sidebar.endPeek()
          }
          .keyboardShortcut(.cancelAction)
          .opacity(0)
          .accessibilityHidden(true)
        }
        AlternateShortcuts(commands: [.toggleSidebar], context: context)
        if app.browse.search != nil {
          CommandBar(windowSize: frame.window)
            .transition(.opacity.combined(with: .scale(scale: SidebarChrome.CommandBar.enterScale, anchor: .top)))
            .zIndex(1)
        }
      }
      .coordinateSpace(.named(SidebarFrame.space))
      .modifier(SidebarPeekPointer(frame: frame, placement: placement))
      .ignoresSafeArea()
    }
    .animation(reduceMotion ? .easeOut(duration: Tokens.Duration.base) : Tokens.Spring.sidebarDock.animation, value: placement)
    .animation(.easeOut(duration: Tokens.Duration.base), value: app.browse.search != nil)
    .focusedSceneValue(\.sidebarContext, context)
    .onChange(of: layout, initial: true) { _, layout in
      sidebar.adapt(to: layout)
      SidebarDemo.current.applyVisibility(to: sidebar)
    }
    .onChange(of: hinge) { _, _ in sidebar.adapt(to: layout) }
    .onChange(of: app.settings.showsSidebarAtEdge) { _, isOn in
      guard !isOn else { return }
      sidebar.cancelGestures()
      sidebar.endPeek()
    }
    .onChange(of: app.tabs.selectedTabID, initial: true) { old, new in
      app.syncSurfaceForSidebar()
      if new != nil { sidebar.notePageShown() }
      if let old, old != new, app.sidebarOrder.contains(where: { $0.id == old }) { sidebar.dismissOverlay() }
    }
    .onAppear { app.web.adopt(SiteVersion(layout: layout)) }
    .onDisappear {
      sidebar.adapt(to: .bar)
      app.web.adopt(SiteVersion(layout: .bar))
    }
    .task(id: context) { await SidebarDemo.current.apply(app: app, sidebar: sidebar, context: context) }
  }

  private var context: SidebarContext { SidebarContext(layout: layout, hinge: hinge) }

  private var edge: HorizontalEdge {
    SidebarWidth.edge(macSide: app.sync.snapshot.lookSettings?.sidebarSide?.rawValue)
  }
}

struct SidebarFrame {
  static let space = "sidebarShell"

  let window: CGSize
  let safeTop: CGFloat
  let width: CGFloat
  let edge: HorizontalEdge
  let cardRadius: CGFloat

  init(proxy: GeometryProxy, width: CGFloat, edge: HorizontalEdge, cardRadius: CGFloat) {
    let insets = proxy.safeAreaInsets
    window = CGSize(width: proxy.size.width + insets.leading + insets.trailing, height: proxy.size.height + insets.top + insets.bottom)
    safeTop = insets.top
    self.width = SidebarWidth.fitted(width, windowWidth: window.width)
    self.edge = edge
    self.cardRadius = cardRadius
  }

  var cardTop: CGFloat { max(safeTop, SidebarMetrics.cardInset) }
  var alignment: Alignment { edge == .leading ? .leading : .trailing }
  var slideEdge: Edge { edge == .leading ? .leading : .trailing }
}

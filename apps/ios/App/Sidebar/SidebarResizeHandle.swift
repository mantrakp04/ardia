import ArdiaDesign
import SwiftUI

struct SidebarResizeHandle: View {
  let edge: HorizontalEdge
  let windowWidth: CGFloat

  @Environment(SidebarState.self) private var sidebar
  @State private var dragStart: CGFloat?
  @State private var isHovering = false
  @GestureState private var isResizing = false

  var body: some View {
    Color.clear
      .frame(width: SidebarChrome.Edge.handleHitWidth)
      .frame(maxHeight: .infinity)
      .contentShape(.rect)
      .overlay {
        Capsule()
          .fill(Tokens.Role.divider)
          .frame(width: SidebarChrome.Edge.handleWidth)
          .padding(.vertical, SidebarMetrics.headerHeight)
          .opacity(isHovering || dragStart != nil ? 1 : 0)
      }
      .onHover { isHovering = $0 }
      .gesture(resize)
      .onTapGesture(count: 2) { sidebar.resetWidth() }
      .onChange(of: isResizing) { _, resizing in
        guard !resizing, dragStart != nil else { return }
        dragStart = nil
        sidebar.dragWidth = nil
      }
      .accessibilityElement()
      .accessibilityLabel(String(localized: "Sidebar Width"))
      .accessibilityValue(Text(shownWidth, format: .number.precision(.fractionLength(0))))
      .accessibilityHint(String(localized: "Double-tap to reset."))
      .accessibilityAdjustableAction { direction in
        let step = SidebarMetrics.Row.height
        switch direction {
        case .increment: sidebar.commitWidth(SidebarWidth.adjusted(sidebar.width, by: step, windowWidth: windowWidth))
        case .decrement: sidebar.commitWidth(SidebarWidth.adjusted(sidebar.width, by: -step, windowWidth: windowWidth))
        @unknown default: break
        }
      }
  }

  private var shownWidth: CGFloat {
    SidebarWidth.fitted(sidebar.width, windowWidth: windowWidth)
  }

  private var resize: some Gesture {
    DragGesture(minimumDistance: SidebarChrome.Edge.dragThreshold, coordinateSpace: .global)
      .updating($isResizing) { _, resizing, _ in resizing = true }
      .onChanged { value in
        guard dragStart != nil || SidebarWidth.isResizeDrag(value.translation) else { return }
        let start = dragStart ?? shownWidth
        dragStart = start
        let width = SidebarWidth.fitted(SidebarWidth.dragged(from: start, by: value.translation.width, sidebarOn: edge), windowWidth: windowWidth)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { sidebar.dragWidth = width }
      }
      .onEnded { _ in
        guard dragStart != nil else { return }
        sidebar.commitWidth(sidebar.dragWidth ?? shownWidth)
        dragStart = nil
      }
  }
}

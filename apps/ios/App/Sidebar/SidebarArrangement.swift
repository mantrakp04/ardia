import ArdiaDesign
import SwiftUI

struct SidebarArrangement: View {
  let placement: SidebarPlacement
  let frame: SidebarFrame

  @Environment(SidebarState.self) private var sidebar

  var body: some View {
    switch placement {
    case .foldSplit:
      FoldSplit {
        PageCard(placement: placement, edge: frame.edge, radius: frame.cardRadius)
          .padding(.horizontal, SidebarMetrics.cardInset)
          .padding(.top, frame.cardTop)
          .padding(.bottom, SidebarMetrics.cardInset)
      } secondary: {
        SidebarColumn(width: frame.window.width, edge: frame.edge, showsPinned: false, showsToggle: false)
      }
    case .docked, .hidden, .peek, .overlay, .none:
      ZStack(alignment: frame.alignment) {
        besidePage
        if placement == .peek {
          Color.clear
            .contentShape(.rect)
            .onTapGesture { sidebar.endPeek() }
            .accessibilityHidden(true)
          SidebarPeekPanel(frame: frame)
        }
        if placement == .overlay || sidebar.peekDrag != nil {
          SidebarOverlay(frame: frame)
        }
      }
    }
  }

  private var besidePage: some View {
    let isDocked = placement == .docked
    return PageCard(placement: placement, edge: frame.edge, radius: frame.cardRadius)
      .padding(.top, frame.cardTop)
      .padding(.bottom, SidebarMetrics.cardInset)
      .modifier(CardSideInsets(
        leading: isDocked && frame.edge == .leading ? frame.width : SidebarMetrics.cardInset,
        trailing: isDocked && frame.edge == .trailing ? frame.width : SidebarMetrics.cardInset
      ))
      .overlay(alignment: frame.alignment) {
        if isDocked {
          dockedColumn
        }
      }
  }

  private var dockedColumn: some View {
    SidebarColumn(width: frame.width, edge: frame.edge, showsPinned: true, showsToggle: true)
      .padding(.top, frame.safeTop)
      .frame(width: frame.width)
      .overlay(alignment: frame.edge == .leading ? .trailing : .leading) {
        SidebarResizeHandle(edge: frame.edge, windowWidth: frame.window.width)
      }
      .transition(.move(edge: frame.slideEdge).combined(with: .opacity))
  }
}

private struct CardSideInsets: ViewModifier, Animatable {
  var leading: CGFloat
  var trailing: CGFloat

  var animatableData: AnimatablePair<CGFloat, CGFloat> {
    get { AnimatablePair(leading, trailing) }
    set {
      leading = newValue.first
      trailing = newValue.second
    }
  }

  func body(content: Content) -> some View {
    content
      .padding(.leading, leading)
      .padding(.trailing, trailing)
  }
}

import ArdiaDesign
import SwiftUI

struct DeckColumn: View {
  let column: ScreenLayout.SideColumn
  let size: CGSize
  let isGrid: Bool
  @Binding var query: String
  var searchFocus: FocusState<Bool>.Binding
  let plus: PlusActions
  let toggleGrid: () -> Void
  let closeAll: () -> Void

  @Environment(AppModel.self) private var app

  private var showsField: Bool { searchFocus.wrappedValue || !query.isEmpty }

  var body: some View {
    ZStack {
      SideColumnStack(column: column, size: size) {
        GlassCircleButton(symbol: isGrid ? "square.stack" : "square.grid.2x2", label: isGrid ? "Show as Stack" : "Show as Grid", diameter: DuoLayout.columnButton, action: toggleGrid)
        GlassCircleButton(symbol: "magnifyingglass", label: "Search Tabs", diameter: DuoLayout.columnButton) { searchFocus.wrappedValue = true }
        DuoMoreMenu(hasTabs: !app.deckTabs.isEmpty, closeAll: closeAll, diameter: DuoLayout.columnButton)
        PlusButton(actions: plus, width: DuoLayout.columnButton)
      }
      SearchTabsField(query: $query, focus: searchFocus)
        .frame(width: max(column.contentWidth(in: size.width) - DuoLayout.columnFieldSide * 2, 0))
        .position(x: fieldCenterX, y: searchCenterY)
        .opacity(showsField ? 1 : 0)
        .allowsHitTesting(showsField)
        .accessibilityHidden(!showsField)
        .animation(.smooth(duration: 0.25), value: showsField)
    }
    .frame(width: size.width, height: size.height)
    .task { await fillQueryForDemo() }
  }

  private func fillQueryForDemo() async {
    #if DEBUG
    let arguments = ProcessInfo.processInfo.arguments
    guard app.isDemo, let index = arguments.firstIndex(of: "-ArdiaDeckQuery"), arguments.indices.contains(index + 1) else { return }
    try? await Task.sleep(for: .seconds(1.5))
    query = arguments[index + 1]
    #endif
  }

  private var fieldCenterX: CGFloat {
    let content = column.contentWidth(in: size.width)
    return column.edge == .trailing ? content / 2 : size.width - content / 2
  }

  private var searchCenterY: CGFloat {
    column.top + DuoLayout.columnButton * 1.5 + DuoLayout.columnSpacing
  }
}

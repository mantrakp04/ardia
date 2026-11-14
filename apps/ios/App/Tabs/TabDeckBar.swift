import ArdiaDesign
import SwiftUI

struct StartBar: View {
  let geometry: TabsDeckGeometry
  let plus: PlusActions
  let tabs: () -> Void
  let settings: () -> Void

  @Environment(\.screenLayout) private var screenLayout

  var body: some View {
    if let column = screenLayout.column {
      SideColumnStack(column: column, size: geometry.container) {
        GlassCircleButton(symbol: "square.on.square", label: "Tabs", diameter: DuoLayout.columnButton, action: tabs)
        PlusButton(actions: plus, width: DuoLayout.columnButton)
        GlassCircleButton(symbol: "gearshape", label: "Settings", diameter: DuoLayout.columnButton, action: settings)
      }
    } else {
      row
    }
  }

  private var row: some View {
    HStack(spacing: 0) {
      GlassCircleButton(symbol: "square.on.square", label: "Tabs", action: tabs)
      Spacer(minLength: TabsLayout.barGap)
      PlusButton(actions: plus, width: TabsLayout.barPlus.width)
      Spacer(minLength: TabsLayout.barGap)
      GlassCircleButton(symbol: "gearshape", label: "Settings", action: settings)
    }
    .padding(.horizontal, geometry.safeSide + TabsLayout.barSideInset)
    .frame(width: geometry.container.width)
    .position(x: geometry.container.width / 2, y: geometry.barCenterY)
  }
}

struct DeckBottomBar: View {
  let geometry: TabsDeckGeometry
  let isGrid: Bool
  @Binding var query: String
  var searchFocus: FocusState<Bool>.Binding
  let plus: PlusActions
  let toggleGrid: () -> Void

  var body: some View {
    HStack(spacing: TabsLayout.barGap) {
      GlassCircleButton(symbol: isGrid ? "square.stack" : "square.grid.2x2", label: isGrid ? "Show as Stack" : "Show as Grid", action: toggleGrid)
      SearchTabsField(query: $query, focus: searchFocus)
      PlusButton(actions: plus, width: TabsLayout.barCircle)
    }
    .padding(.horizontal, geometry.safeSide + TabsLayout.barSideInset)
  }
}

struct PlusActions {
  var isIncognito: Bool
  var canReopen: Bool
  var newTab: () -> Void
  var newRegularTab: () -> Void
  var newIncognitoTab: () -> Void
  var reopen: () -> Void
}

struct PlusButton: View {
  let actions: PlusActions
  let width: CGFloat

  var body: some View {
    Button(action: actions.newTab) {
      Image(systemName: "plus")
        .font(.system(size: 18, weight: .medium))
        .foregroundStyle(.primary)
        .frame(width: width, height: TabsLayout.barCircle)
        .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .chromeSurface(in: .capsule)
    .contextMenu {
      if actions.isIncognito {
        Button("New Tab", action: actions.newRegularTab)
        Button("New Incognito Tab", action: actions.newTab)
      } else {
        Button("New Incognito Tab", action: actions.newIncognitoTab)
      }
      if actions.canReopen {
        Button("Reopen Closed Tab", action: actions.reopen)
      }
    }
    .accessibilityLabel(actions.isIncognito ? "New Incognito Tab" : "New Tab")
    .accessibilityHint("Touch and hold for more options.")
  }
}

struct GlassCircleButton: View {
  let symbol: String
  let label: LocalizedStringKey
  var diameter = TabsLayout.barCircle
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      GlassCircleFace(symbol: symbol, diameter: diameter)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

struct GlassCircleFace: View {
  let symbol: String
  var diameter = TabsLayout.barCircle

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: 16, weight: .medium))
      .foregroundStyle(.primary)
      .frame(width: diameter, height: diameter)
      .contentShape(.circle)
      .chromeSurface(in: .circle)
  }
}

struct SearchTabsField: View {
  @Binding var query: String
  var focus: FocusState<Bool>.Binding

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
      TextField("Search Tabs", text: $query)
        .font(.callout)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.search)
        .focused(focus)
        .accessibilityLabel("Search Tabs")
        .onSubmit { focus.wrappedValue = false }
      if !query.isEmpty {
        Button {
          query = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 19))
            .foregroundStyle(.secondary)
            .frame(width: 32, height: 32)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear Search")
      }
    }
    .padding(.leading, 13)
    .padding(.trailing, query.isEmpty ? 16 : 8)
    .frame(maxWidth: .infinity, minHeight: TabsLayout.barCircle)
    .contentShape(.capsule)
    .onTapGesture { focus.wrappedValue = true }
    .chromeSurface(in: .capsule)
  }
}

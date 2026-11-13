import ArdiaDesign
import SwiftUI

struct DeckBar: View {
  struct Actions {
    var newTab: () -> Void
    var newRegularTab: () -> Void
    var newIncognitoTab: () -> Void
    var reopen: () -> Void
    var closeAll: () -> Void
    var leading: () -> Void
  }

  let width: CGFloat
  var isRail = false
  let isIncognito: Bool
  let showsSpaces: Bool
  let canReopen: Bool
  let hasTabs: Bool
  @Binding var query: String
  var searchFocus: FocusState<Bool>.Binding
  let actions: Actions

  var openSearch: () -> Void = {}

  var body: some View {
    GlassBar {
      if isRail {
        VStack(spacing: BarMetrics.pieceGap) {
          leadingButton
          searchCircle
          DeckMoreMenu(canClose: hasTabs, closeAll: actions.closeAll, size: BarMetrics.pieceHeight, morphID: BarMorph.menu)
          plusButton
        }
      } else {
        HStack(spacing: BarMetrics.pieceGap) {
          leadingButton
          DeckSearchField(query: $query, searchFocus: searchFocus, morphID: BarMorph.address)
          plusButton
        }
        .frame(width: width, height: BarMetrics.pieceHeight)
      }
    }
  }

  private var searchCircle: some View {
    Button(action: openSearch) {
      Image(systemName: "magnifyingglass")
        .font(Typography.body.weight(Tokens.Weight.medium))
        .foregroundStyle(Tokens.Role.textPrimary)
        .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
        .contentShape(.circle)
    }
    .buttonStyle(.glassControl(.circle, state: query.isEmpty ? .rest : .active, morphID: BarMorph.address))
    .accessibilityLabel("Search Tabs")
    .accessibilityValue(query)
  }

  private var leadingButton: some View {
    Button(action: actions.leading) {
      Image(systemName: showsSpaces ? "square.grid.2x2" : "archivebox")
        .font(Typography.body.weight(Tokens.Weight.medium))
        .foregroundStyle(Tokens.Role.textPrimary)
        .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
        .contentShape(.circle)
    }
    .buttonStyle(.glassControl(.circle, morphID: BarMorph.tabs))
    .accessibilityLabel(showsSpaces ? "Space" : "Archive")
    .accessibilityHint(showsSpaces ? "Shows the pinned tabs and your Mac’s tabs for this space." : "")
  }

  private var plusButton: some View {
    Button(action: actions.newTab) {
      Image(systemName: "plus")
        .font(Typography.title)
        .foregroundStyle(Tokens.Role.textPrimary)
        .frame(width: BarMetrics.pieceHeight, height: BarMetrics.pieceHeight)
        .contentShape(.circle)
    }
    .buttonStyle(.glassControl(.circle, morphID: BarMorph.plus))
    .contextMenu {
      if isIncognito {
        Button("New Tab", systemImage: "plus", action: actions.newRegularTab)
        Button("New Incognito Tab", systemImage: "eyes", action: actions.newTab)
      } else {
        Button("New Incognito Tab", systemImage: "eyes", action: actions.newIncognitoTab)
      }
      if canReopen {
        Button("Reopen Closed Tab", systemImage: "arrow.uturn.backward", action: actions.reopen)
      }
      if hasTabs {
        Divider()
        Button(isIncognito ? "Close Incognito Tabs" : "Close All Tabs", systemImage: "xmark", role: .destructive, action: actions.closeAll)
      }
    }
    .accessibilityLabel(isIncognito ? "New Incognito Tab" : "New Tab")
    .accessibilityHint("Touch and hold for more options.")
  }
}

struct DeckSearchField: View {
  @Binding var query: String
  var searchFocus: FocusState<Bool>.Binding
  var morphID: String?

  var body: some View {
    HStack(spacing: BarMetrics.addressGap) {
      Image(systemName: "magnifyingglass")
        .font(Typography.caption.weight(Tokens.Weight.semibold))
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
      TextField("Search Tabs", text: $query)
        .font(Typography.field)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.done)
        .focused(searchFocus)
        .onSubmit { searchFocus.wrappedValue = false }
      if !query.isEmpty {
        Button {
          query = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(.secondary)
            .frame(width: GlassMetrics.hitTarget, height: BarMetrics.pieceHeight)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Clear Search")
      }
    }
    .padding(.leading, Tokens.Space.l)
    .padding(.trailing, query.isEmpty ? Tokens.Space.l : 0)
    .frame(maxWidth: .infinity, minHeight: BarMetrics.pieceHeight, maxHeight: BarMetrics.pieceHeight)
    .contentShape(.capsule)
    .onTapGesture { searchFocus.wrappedValue = true }
    .glassControl(.capsule, state: searchFocus.wrappedValue ? .active : .rest, morphID: morphID)
  }
}

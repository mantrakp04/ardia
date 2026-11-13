import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct CommandBar: View {
  let windowSize: CGSize

  @Environment(AppModel.self) private var app
  @Environment(\.colorScheme) private var colorScheme
  @State private var model: SearchSuggestionsModel?
  @State private var text = ""
  @State private var isFocused = false
  @State private var highlighted: Int?
  @State private var isSubmitting = false

  var body: some View {
    let rows = Array((model?.rows ?? []).prefix(SidebarChrome.CommandBar.rowLimit))
    ZStack(alignment: .top) {
      Rectangle()
        .fill(Tokens.Role.scrim)
        .contentShape(.rect)
        .onTapGesture { app.cancelSearch() }
        .accessibilityLabel(String(localized: "Close Search"))
        .accessibilityAddTraits(.isButton)
      panel(rows)
        .frame(width: SidebarChrome.commandBarWidth(windowWidth: windowSize.width))
        .padding(.top, SidebarChrome.commandBarTop(windowHeight: windowSize.height))
    }
    .background {
      Button(String(localized: "Close Search")) { app.cancelSearch() }
        .keyboardShortcut(.cancelAction)
        .opacity(0)
        .accessibilityHidden(true)
    }
    .onAppear(perform: start)
    .onDisappear { model?.cancel() }
    .onChange(of: text) { _, value in
      guard !isSubmitting else { return }
      model?.update(value)
      highlighted = nil
      keepDraft(value)
    }
    .onChange(of: app.isIncognito) { _, _ in rebuildModel() }
    .task { await SearchSuggestionsModel.loadRecents(from: app.tabs) }
  }

  private func panel(_ rows: [SearchSuggestion]) -> some View {
    VStack(spacing: 0) {
      field
      if !rows.isEmpty {
        Rectangle()
          .fill(Tokens.Role.divider)
          .frame(height: Tokens.Hairline.panel)
          .padding(.vertical, Tokens.Space.xs)
        VStack(spacing: 0) {
          ForEach(Array(rows.enumerated()), id: \.element.id) { index, suggestion in
            SuggestionRowView(suggestion: suggestion, typed: text, isHighlighted: highlighted == index, isIncognito: app.isIncognito)
              .onTapGesture { activate(suggestion) }
              .onHover { hovering in if hovering { highlighted = index } }
              .accessibilityAddTraits(.isButton)
              .accessibilityAction { activate(suggestion) }
          }
        }
      }
    }
    .padding(SidebarChrome.CommandBar.inset)
    .glassPanel(.rounded)
    .environment(\.colorScheme, app.isIncognito ? .dark : colorScheme)
    .accessibilityAddTraits(.isModal)
  }

  private var field: some View {
    HStack(spacing: Tokens.Space.m) {
      Image(systemName: "magnifyingglass")
        .font(Typography.body.weight(Tokens.Weight.medium))
        .foregroundStyle(Tokens.Role.textSecondary)
        .accessibilityHidden(true)
      OmniboxTextField(
        text: $text,
        isFocused: $isFocused,
        completion: model?.completion,
        placeholder: String(localized: "Search or Enter Address"),
        isIncognito: app.isIncognito,
        selectsAllOnFocus: app.browse.search?.selectsAll ?? false,
        onSubmit: submit,
        onKey: handle
      )
      .frame(maxWidth: .infinity)
      if !text.isEmpty {
        Button {
          text = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(Tokens.Role.textTertiary)
            .frame(width: GlassMetrics.hitTarget, height: GlassMetrics.hitTarget)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(String(localized: "Clear Text"))
      }
      IncognitoToggle(isOn: app.isIncognito) {
        app.isIncognito.toggle()
      }
    }
    .padding(.leading, Tokens.Space.l)
    .frame(height: SidebarChrome.CommandBar.fieldHeight)
  }

  private func keepDraft(_ value: String) {
    guard var request = app.browse.search, request.initialText != value else { return }
    request.initialText = value
    request.selectsAll = false
    app.browse.search = request
  }

  private func start() {
    if model == nil { rebuildModel() }
    let initial = app.browse.search?.initialText ?? ""
    text = initial
    model?.update(initial)
    isFocused = !app.settings.isShowingOnboarding
  }

  private func rebuildModel() {
    let fresh = app.makeSuggestionsModel()
    model = fresh
    fresh.update(text)
    Task { await fresh.prepare() }
  }

  private func submit(_ value: String) {
    let rows = Array((model?.rows ?? []).prefix(SidebarChrome.CommandBar.rowLimit))
    if let highlighted, rows.indices.contains(highlighted) {
      activate(rows[highlighted])
      return
    }
    let model = model
    Task {
      let resolution = await model?.resolve(value)
      guard resolution != nil || SearchInput.resolve(value) != nil else { return }
      isSubmitting = true
      text = value
      isFocused = false
      app.submitSearch(value, resolution: resolution)
    }
  }

  private func activate(_ suggestion: SearchSuggestion) {
    if case .calculation = suggestion.kind {} else {
      isFocused = false
      app.browse.dismissSearch()
    }
    app.activate(suggestion)
  }

  private func handle(_ key: OmniboxKey) {
    switch key {
    case .up: moveHighlight(by: -1)
    case .down: moveHighlight(by: 1)
    case .escape: app.cancelSearch()
    }
  }

  private func moveHighlight(by delta: Int) {
    let count = min(model?.rows.count ?? 0, SidebarChrome.CommandBar.rowLimit)
    highlighted = ListHighlight.moved(from: highlighted, by: delta, count: count)
  }
}

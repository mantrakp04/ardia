import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct SearchSheet<Above: View>: View {
  enum Style {
    case home
    case overlay
  }

  let style: Style
  let initialText: String
  let selectsAll: Bool
  var fieldNamespace: Namespace.ID?
  var focusesOnAppear = false
  var onDismiss: (() -> Void)?
  @ViewBuilder var above: () -> Above

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @State private var model: SearchSuggestionsModel?
  @State private var text = ""
  @State private var isFocused = false
  @State private var highlight: (id: String, target: SuggestionTarget)?
  @State private var rowFrames: [String: CGRect] = [:]
  @State private var scrubTicks = 0
  @State private var scrubReleases = 0
  @State private var isScrubbing = false
  @State private var scrubStart: CGPoint?
  @State private var dragDismiss: CGFloat = 0
  @ScaledMetric(relativeTo: .title3) private var fieldHeight = BrowseLayout.searchFieldHeight

  private var isIncognito: Bool { app.isIncognito }
  private var isExpanded: Bool { !text.isEmpty }

  var body: some View {
    GeometryReader { proxy in
      let top = sheetTop(in: proxy.size)
      ZStack(alignment: .top) {
        above()
          .frame(maxWidth: .infinity)
          .frame(height: max(top, 0), alignment: .bottom)
          .opacity(isExpanded ? 0 : 1)
          .allowsHitTesting(!isExpanded)
        sheet(height: proxy.size.height - top, bottomInset: proxy.safeAreaInsets.bottom)
          .offset(y: top + max(dragDismiss, 0))
      }
      .animation(reduceMotion ? .easeOut(duration: 0.2) : Motion.sheetToTop, value: isExpanded)
    }
    .onAppear(perform: start)
    .onChange(of: text) { _, newValue in
      model?.update(newValue)
      highlight = nil
    }
    .onChange(of: app.isIncognito) { _, _ in rebuildModel() }
    .onChange(of: app.settings.isShowingOnboarding) { _, showing in
      if showing {
        isFocused = false
      } else if app.settings.autoOpensKeyboard {
        isFocused = true
      }
    }
    .sensoryFeedback(.selection, trigger: scrubTicks)
    .sensoryFeedback(.impact(weight: .light), trigger: scrubReleases)
  }

  private func sheetTop(in size: CGSize) -> CGFloat {
    if isExpanded { return Spacing.hairline + 2 }
    let resting = size.height - BrowseLayout.sheetAboveKeyboard
    return max(resting, min(size.height * 0.32, 220))
  }

  private func sheet(height: CGFloat, bottomInset: CGFloat) -> some View {
    VStack(spacing: 0) {
      grabber
      fieldRow
        .padding(.top, Spacing.small)
        .padding(.bottom, Spacing.tight)
      content(visibleHeight: height - fieldHeight - 40)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity)
    .frame(height: height + 400, alignment: .top)
    .background {
      sheetBackground
        .ignoresSafeArea()
    }
    .environment(\.colorScheme, isIncognito ? .dark : colorSchemeForSheet)
  }

  @Environment(\.colorScheme) private var colorSchemeForSheet

  private var grabber: some View {
    Capsule()
      .fill(isIncognito ? Color.white.opacity(0.18) : BrowsePalette.foregroundTertiary.opacity(0.5))
      .frame(width: 36, height: 5)
      .padding(.top, 6)
      .frame(maxWidth: .infinity, minHeight: 14)
      .contentShape(.rect)
      .gesture(dismissDrag)
      .accessibilityHidden(true)
      .opacity(canDismiss ? 1 : 0)
  }

  private var canDismiss: Bool {
    style == .overlay || app.tabs.selectedTab != nil || onDismiss != nil
  }

  private var sheetBackground: some View {
    UnevenRoundedRectangle(topLeadingRadius: BrowseLayout.sheetTopRadius, topTrailingRadius: BrowseLayout.sheetTopRadius, style: .continuous)
      .fill(isIncognito || reduceTransparency ? AnyShapeStyle(.clear) : AnyShapeStyle(.regularMaterial))
      .overlay {
        UnevenRoundedRectangle(topLeadingRadius: BrowseLayout.sheetTopRadius, topTrailingRadius: BrowseLayout.sheetTopRadius, style: .continuous)
          .fill(sheetTint)
      }
      .shadow(color: .black.opacity(0.12), radius: 24, y: -4)
  }

  private var sheetTint: Color {
    if isIncognito { return BrowsePalette.incognitoSheet }
    return reduceTransparency ? BrowsePalette.sheetOpaque : BrowsePalette.sheet
  }

  private var fieldRow: some View {
    field
      .padding(.horizontal, BrowseLayout.searchFieldInset)
  }

  private var field: some View {
    HStack(spacing: Spacing.tight) {
      OmniboxTextField(
        text: $text,
        isFocused: $isFocused,
        completion: model?.completion,
        placeholder: String(localized: "Search..."),
        isIncognito: isIncognito,
        selectsAllOnFocus: selectsAll,
        onSubmit: submit
      )
      .frame(maxWidth: .infinity)
      .frame(height: fieldHeight)
      .layoutPriority(1)
      fieldAccessories
        .fixedSize()
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
    .padding(.leading, 18)
    .padding(.trailing, 10)
    .frame(minHeight: fieldHeight)
    .background {
      Capsule(style: .continuous)
        .fill(isIncognito ? BrowsePalette.incognitoField : BrowsePalette.fieldFill)
        .overlay {
          Capsule(style: .continuous)
            .strokeBorder(isIncognito ? Color.white.opacity(0.1) : BrowsePalette.fieldStroke, lineWidth: 1)
        }
    }
    .modifier(MatchedField(namespace: fieldNamespace))
  }

  @ViewBuilder
  private var fieldAccessories: some View {
    if !text.isEmpty {
      Button {
        text = ""
      } label: {
        Image(systemName: "xmark.circle.fill")
          .font(.body)
          .foregroundStyle(isIncognito ? BrowsePalette.incognitoCaption : BrowsePalette.foregroundTertiary)
          .frame(width: 32, height: 40)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Clear Text")
    } else if !dynamicTypeSize.isAccessibilitySize, !isIncognito {
      Button {
        app.browse.isVoicePresented = true
      } label: {
        Image(systemName: "mic")
          .font(.body.weight(.medium))
          .foregroundStyle(isIncognito ? BrowsePalette.incognitoCaption : BrowsePalette.foregroundTertiary)
          .frame(width: 32, height: 40)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Voice Search")
    }
    IncognitoToggle(isOn: isIncognito) {
      withAnimation(Motion.modeToggle) { app.isIncognito.toggle() }
    }
  }

  @ViewBuilder
  private func content(visibleHeight: CGFloat) -> some View {
    let rows = model?.rows ?? []
    if isIncognito, text.isEmpty {
      Text("You’re browsing Incognito")
        .font(.title3.weight(.semibold))
        .foregroundStyle(BrowsePalette.incognitoCaption)
        .multilineTextAlignment(.center)
        .padding(.horizontal, Spacing.large)
        .frame(maxWidth: .infinity, minHeight: max(visibleHeight, 80))
        .transition(.opacity)
    } else if !rows.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        if let device = model?.idleDeviceName {
          Text("From Your \(device)")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(BrowsePalette.foregroundSecondary)
            .padding(.horizontal, 20)
            .padding(.top, Spacing.tight)
            .padding(.bottom, Spacing.hairline)
        }
        if dynamicTypeSize.isAccessibilitySize {
          ScrollView {
            rowStack(rows)
          }
          .scrollDismissesKeyboard(.interactively)
        } else {
          rowStack(rows)
            .mask { fadeMask }
            .gesture(scrub(rows))
        }
      }
      .transition(.opacity.animation(Motion.resultsIn))
    }
  }

  private var fadeMask: some View {
    LinearGradient(
      stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.62), .init(color: .black.opacity(0.18), location: 1)],
      startPoint: .top,
      endPoint: .bottom
    )
  }

  private func rowStack(_ rows: [SearchSuggestion]) -> some View {
    VStack(spacing: 0) {
      ForEach(rows) { suggestion in
        SuggestionRowView(
          suggestion: suggestion,
          typed: text,
          highlight: highlight?.id == suggestion.id ? highlight?.target : nil,
          isIncognito: isIncognito,
          offersBrowseForMe: app.offersBrowseForMe,
          onBrowseForMe: dynamicTypeSize.isAccessibilitySize ? { activate(suggestion, .browseForMe) } : nil
        )
        .gesture(TapGesture().onEnded { activate(suggestion, .row) }, isEnabled: dynamicTypeSize.isAccessibilitySize)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("rows")) } action: { rowFrames[suggestion.id] = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { activate(suggestion, .row) }
        .accessibilityActions {
          if app.offersBrowseForMe, suggestion.offersBrowseForMe {
            Button("Browse for Me") { activate(suggestion, .browseForMe) }
          }
        }
        .contextMenu { rowMenu(suggestion) }
      }
    }
    .padding(.horizontal, Spacing.tight)
    .coordinateSpace(.named("rows"))
  }

  @ViewBuilder
  private func rowMenu(_ suggestion: SearchSuggestion) -> some View {
    switch suggestion.kind {
    case .query:
      Button(isIncognito ? "Search in New Tab" : "Search in Incognito Tab", systemImage: isIncognito ? "plus.square.on.square" : "eyeglasses") {
        isFocused = false
        model?.cancel()
        app.isIncognito.toggle()
        app.openSearch(suggestion.query)
      }
    case .calculation:
      if let value = suggestion.copyValue {
        Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = value }
      }
    default:
      if let link = suggestion.url.flatMap(URL.init(string:)) {
        Button(isIncognito ? "Open in New Tab" : "Open in Incognito Tab", systemImage: isIncognito ? "plus.square.on.square" : "eyeglasses") {
          openSwitchingMode(link)
        }
        Button("Copy Link", systemImage: "link") {
          app.web.copyLink(link)
          app.toasts.show(Toast(String(localized: "Copied Link"), symbol: "link"))
        }
        ShareLink(item: link) {
          Label("Share", systemImage: "square.and.arrow.up")
        }
      }
    }
  }

  private func openSwitchingMode(_ link: URL) {
    isFocused = false
    model?.cancel()
    app.isIncognito.toggle()
    app.openPage(link, origin: .typed)
  }

  private func scrub(_ rows: [SearchSuggestion]) -> some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named("rows"))
      .onChanged { value in
        if scrubStart != value.startLocation {
          scrubStart = value.startLocation
          isScrubbing = false
        }
        if abs(value.translation.height) > 6 || abs(value.translation.width) > 6 { isScrubbing = true }
        guard let hit = hitTest(value.location, rows: rows) else {
          highlight = nil
          return
        }
        if highlight?.id != hit.id || highlight?.target != hit.target {
          if isScrubbing { scrubTicks += 1 }
          withAnimation(Motion.press) { highlight = hit }
        }
      }
      .onEnded { value in
        let wasScrubbing = isScrubbing && scrubStart == value.startLocation
        isScrubbing = false
        scrubStart = nil
        let hit = hitTest(value.location, rows: rows)
        withAnimation(Motion.press) { highlight = nil }
        guard let hit, let suggestion = rows.first(where: { $0.id == hit.id }) else { return }
        if wasScrubbing { scrubReleases += 1 }
        activate(suggestion, hit.target)
      }
  }

  private func hitTest(_ point: CGPoint, rows: [SearchSuggestion]) -> (id: String, target: SuggestionTarget)? {
    for suggestion in rows {
      guard let frame = rowFrames[suggestion.id], frame.minY <= point.y, point.y < frame.maxY, frame.minX - 8 <= point.x, point.x <= frame.maxX + 8 else { continue }
      let pillEdge = frame.maxX - BrowseLayout.highlightedPillSize.width - 14
      let target: SuggestionTarget = app.offersBrowseForMe && suggestion.offersBrowseForMe && point.x >= pillEdge ? .browseForMe : .row
      return (suggestion.id, target)
    }
    return nil
  }

  private var dismissDrag: some Gesture {
    DragGesture(minimumDistance: 4)
      .onChanged { value in
        guard canDismiss else { return }
        dragDismiss = max(0, value.translation.height)
      }
      .onEnded { value in
        guard canDismiss else { return }
        if value.predictedEndTranslation.height > 140 || value.translation.height > 90 {
          isFocused = false
          if style == .home, app.tabs.selectedTab == nil, let onDismiss {
            model?.cancel()
            onDismiss()
          } else {
            app.cancelSearch()
          }
        }
        withAnimation(Motion.snappy) { dragDismiss = 0 }
      }
  }

  private func start() {
    if model == nil { rebuildModel() }
    text = initialText
    model?.update(initialText)
    if !app.settings.isShowingOnboarding, focusesOnAppear || app.settings.autoOpensKeyboard || style == .overlay || !initialText.isEmpty {
      isFocused = true
    }
    if app.offersBrowseForMe { app.intelligence.searchFieldDidBeginEditing() }
  }

  private func rebuildModel() {
    let fresh = app.makeSuggestionsModel()
    model = fresh
    fresh.update(text)
    Task { await fresh.prepare() }
  }

  private func submit(_ value: String) {
    isFocused = false
    let model = model
    Task {
      let resolution = await model?.resolve(value)
      model?.cancel()
      app.submitSearch(value, resolution: resolution)
    }
  }

  private func activate(_ suggestion: SearchSuggestion, _ target: SuggestionTarget) {
    isFocused = false
    model?.cancel()
    app.activate(suggestion, target: target)
  }
}

struct MatchedField: ViewModifier {
  let namespace: Namespace.ID?

  func body(content: Content) -> some View {
    if let namespace {
      content.matchedGeometryEffect(id: "omnibox", in: namespace)
    } else {
      content
    }
  }
}

struct IncognitoToggle: View {
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if isOn {
          Text("Incognito")
            .font(.footnote.weight(.medium))
            .foregroundStyle(.white.opacity(0.75))
            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .trailing)))
        }
        IncognitoEyes(isOpen: isOn)
          .frame(width: 22)
          .foregroundStyle(isOn ? Color.white.opacity(0.85) : BrowsePalette.foregroundTertiary)
      }
      .padding(.horizontal, 6)
      .frame(minWidth: 36, minHeight: 40)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(isOn ? "Deactivate Incognito" : "Activate Incognito")
  }
}

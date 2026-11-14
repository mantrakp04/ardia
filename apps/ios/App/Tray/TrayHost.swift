import ArdiaDesign
import SwiftUI
import UIKit

struct TrayHost: View {
  enum Request: Equatable {
    case search(BrowseSession.SearchRequest)
    case pageMenu(UUID)

    var kind: TrayKind {
      switch self {
      case .search: .search
      case .pageMenu: .pageMenu
      }
    }
  }

  @Environment(AppModel.self) private var app
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    TrayShellRepresentable(
      request: request,
      look: look,
      launch: launch,
      onDismissRequest: dismiss,
      onPresented: claimBar,
      onClosed: closed
    )
    .ignoresSafeArea()
    .allowsHitTesting(request != nil)
    .task { await SearchSuggestionsModel.loadRecents(from: app.tabs) }
    .onChange(of: app.surface) { _, surface in
      if surface != .browsing, app.browse.isToolbarPresented { app.browse.isToolbarPresented = false }
    }
  }

  private var request: Request? {
    if let search = app.browse.search { return .search(search) }
    if app.browse.isToolbarPresented, app.surface == .browsing, let id = app.tabs.selectedTabID { return .pageMenu(id) }
    return nil
  }

  private var restsOnPageBar: Bool { app.surface == .browsing }

  private var barScheme: ColorScheme {
    guard restsOnPageBar, let tab = app.tabs.selectedTab else { return colorScheme }
    return app.browse.tone(for: tab, page: app.currentPage).bottom?.scheme ?? colorScheme
  }

  private var panelIsPrivate: Bool {
    if case .pageMenu(let id) = request { return app.tabs.tab(id)?.isPrivate ?? false }
    return app.isIncognito
  }

  private var look: TrayLook {
    TrayLook(
      panel: UIColor(panelIsPrivate ? BrowsePalette.incognitoSheet : app.look.surface),
      style: UIUserInterfaceStyle(panelIsPrivate ? .dark : colorScheme),
      barStyle: UIUserInterfaceStyle(barScheme)
    )
  }

  private func launch(_ request: Request, shell: TrayShellController) -> TrayLaunch {
    let rest: TrayRest = restsOnPageBar ? .pageBar : .floating
    let pill = rest == .pageBar ? app.browse.pagePlusFrame : app.browse.floatingPlusFrame
    let capsule = rest == .pageBar ? app.browse.pageBarFrame : nil
    let morphs = !reduceMotion && pill.width > 0 && (capsule.map { $0.width > 0 } ?? true)
    let link = TrayContentLink(kind: request.kind, shell: shell)
    let content: AnyView
    var chevron: CGRect?
    switch request {
    case .search(let search):
      content = AnyView(SearchTray(request: search, link: link).trayEnvironment(app, scheme: colorScheme))
    case .pageMenu(let tabID):
      content = AnyView(PageMenuTray(tabID: tabID, link: link, onEditQuery: editQuery, close: closeMenu).trayEnvironment(app, scheme: colorScheme))
      chevron = app.browse.pageChevronFrame
    }
    let sides = PageBarSides(showsChevron: chevron == nil)
      .trayEnvironment(app, scheme: barScheme)
    return TrayLaunch(
      kind: request.kind,
      rest: rest,
      pill: pill,
      capsule: capsule,
      chevron: chevron,
      dims: request.dims,
      focusesField: request.kind == .search && !app.settings.isShowingOnboarding && !app.browse.isVoicePresented,
      morphs: morphs,
      content: content,
      sides: rest == .pageBar ? AnyView(sides) : nil
    )
  }

  private func dismiss() {
    if app.browse.search != nil {
      app.cancelSearch()
    } else {
      closeMenu()
    }
  }

  private func closeMenu() {
    app.browse.isToolbarPresented = false
  }

  private func editQuery() {
    guard let tab = app.tabs.selectedTab else { return }
    let text = app.currentQuery(for: tab)
    app.browse.isToolbarPresented = false
    app.browse.presentSearch(from: .page, text: text, selectsAll: true)
  }

  private func claimBar() {
    let morphs = !reduceMotion
    app.browse.trayOwnsPlus = morphs
    app.browse.trayCoversPageBar = morphs && restsOnPageBar
    app.browse.trayHoldsKeyboard = app.browse.search != nil
  }

  private func closed() {
    app.browse.trayOwnsPlus = false
    app.browse.trayCoversPageBar = false
    app.browse.trayHoldsKeyboard = false
    let tabs = app.tabs
    Task {
      await SearchSuggestionsModel.loadRecents(from: tabs)
      try? await Task.sleep(for: .seconds(3))
      await SearchSuggestionsModel.loadRecents(from: tabs)
    }
  }
}

private extension TrayHost.Request {
  var dims: Bool {
    switch self {
    case .search(let search): search.origin == .page
    case .pageMenu: true
    }
  }
}

private extension View {
  func trayEnvironment(_ app: AppModel, scheme: ColorScheme) -> some View {
    environment(app)
      .environment(\.profileLook, app.look)
      .environment(\.colorScheme, scheme)
  }
}

private struct TrayShellRepresentable: UIViewControllerRepresentable {
  let request: TrayHost.Request?
  let look: TrayLook
  let launch: (TrayHost.Request, TrayShellController) -> TrayLaunch
  let onDismissRequest: () -> Void
  let onPresented: () -> Void
  let onClosed: () -> Void

  @AppStorage("trayKeyboardHeight") private var rememberedKeyboardHeight = 0.0

  func makeUIViewController(context: Context) -> TrayShellController {
    TrayShellController()
  }

  func updateUIViewController(_ shell: TrayShellController, context: Context) {
    shell.onDismissRequest = onDismissRequest
    shell.onClosed = onClosed
    shell.onPresented = onPresented
    shell.onKeyboardHeight = { height in rememberedKeyboardHeight = height }
    shell.apply(look)
    shell.wantedKind = request?.kind
    if let request {
      if shell.presentedKind != request.kind {
        let launch = launch(request, shell)
        let expectedKeyboard = rememberedKeyboardHeight
        DispatchQueue.main.async {
          guard shell.wantedKind == launch.kind else { return }
          shell.present(launch, expectedKeyboard: expectedKeyboard)
        }
      }
    } else if shell.phase != .idle {
      DispatchQueue.main.async {
        guard shell.wantedKind == nil else { return }
        shell.close()
      }
    }
  }
}

private extension UIUserInterfaceStyle {
  init(_ scheme: ColorScheme) {
    self = scheme == .dark ? .dark : .light
  }
}

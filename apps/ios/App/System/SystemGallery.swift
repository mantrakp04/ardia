#if DEBUG
  import ArdiaDesign
  import OSLog
  import SwiftUI
  import UIKit

  @MainActor
  enum SystemDebugHooks {
    static let log = Logger(subsystem: "com.ardia.ios", category: "system")

    static func run(app: AppModel, open: (URL) -> Void) async {
      let arguments = ProcessInfo.processInfo.arguments
      func value(_ key: String) -> String? {
        guard let index = arguments.firstIndex(of: key), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
      }
      try? await Task.sleep(for: .seconds(1.5))
      if app.isDemo, arguments.contains("-SystemGallery") { SystemGalleryPresenter.present(app: app) }
      if let link = value("-SystemLink").flatMap(URL.init(string:)) {
        log.notice("system link \(link.absoluteString, privacy: .public)")
        open(link)
      }
    }
  }

  @MainActor
  enum SystemGalleryPresenter {
    private static var window: UIWindow?

    static func present(app: AppModel) {
      guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
      let arguments = ProcessInfo.processInfo.arguments
      let page = arguments.firstIndex(of: "-SystemGallery").flatMap { index in
        index + 1 < arguments.count ? arguments[index + 1] : nil
      } ?? "search"
      let window = UIWindow(windowScene: scene)
      window.windowLevel = .alert + 1
      window.rootViewController = UIHostingController(rootView: SystemGalleryView(page: page, app: app))
      UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
      window.makeKeyAndVisible()
      self.window = window
    }
  }

  struct SystemGalleryView: View {
    let page: String
    let app: AppModel

    var body: some View {
      if page == "share" {
        share
          .background(Color(hex: 0x8E9AAF).ignoresSafeArea())
      } else {
        ScrollView {
          VStack(spacing: Spacing.medium) {
            switch page {
            case "tabs": tabs
            case "lock": lock
            default: search
            }
          }
          .padding(.vertical, Spacing.section)
          .frame(maxWidth: .infinity)
        }
        .background(Color(hex: 0x8E9AAF).ignoresSafeArea())
      }
    }

    private var search: some View {
      VStack(spacing: Spacing.medium) {
        HStack(spacing: Spacing.medium) {
          tile(.small) { SearchWidgetContent(size: .small, showsBackground: true, offersBrowseForMe: true) } background: {
            SearchWidgetBackground(showsBackground: true)
          }
          tile(.small) { SearchWidgetContent(size: .small, showsBackground: false, offersBrowseForMe: true) } background: {
            SearchWidgetBackground(showsBackground: false)
          }
        }
        tile(.medium) { SearchWidgetContent(size: .medium, showsBackground: true, offersBrowseForMe: true) } background: {
          SearchWidgetBackground(showsBackground: true)
        }
        tile(.medium) { SearchWidgetContent(size: .medium, showsBackground: true, offersBrowseForMe: false) } background: {
          SearchWidgetBackground(showsBackground: true)
        }
        tile(.medium) { SearchWidgetContent(size: .medium, showsBackground: false, offersBrowseForMe: true) } background: {
          SearchWidgetBackground(showsBackground: false)
        }
      }
    }

    private var tabs: some View {
      let snapshot = WidgetExporter.snapshot(for: app)
      return VStack(spacing: Spacing.medium) {
        tile(.medium) { MacTabsWidgetContent(snapshot: snapshot, size: .medium, store: app.systemStore) } background: {
          LaunchGradient(softened: true)
        }
        tile(.large) { MacTabsWidgetContent(snapshot: snapshot, size: .large, store: app.systemStore) } background: {
          LaunchGradient(softened: true)
        }
        tile(.medium) { MacTabsWidgetContent(snapshot: .empty, size: .medium, store: nil) } background: {
          LaunchGradient(softened: true)
        }
      }
    }

    private var lock: some View {
      VStack(spacing: Spacing.large) {
        HStack(spacing: Spacing.large) {
          SearchLockScreenCircular(isVoice: false)
            .frame(width: 72, height: 72)
            .background(.white.opacity(0.18), in: .circle)
          SearchLockScreenCircular(isVoice: true)
            .frame(width: 72, height: 72)
            .background(.white.opacity(0.18), in: .circle)
        }
        SearchLockScreenRectangular(offersBrowseForMe: true)
          .frame(width: 170, height: 72)
        SearchLockScreenRectangular(offersBrowseForMe: false)
          .frame(width: 170, height: 72)
        SearchLockScreenInline()
      }
      .foregroundStyle(.white)
      .environment(\.colorScheme, .dark)
      .padding(Spacing.large)
      .background(Color(hex: 0x1B1F3B), in: .rect(cornerRadius: 30))
    }

    private var share: some View {
      let arguments = ProcessInfo.processInfo.arguments
      let model = ShareSheetModel(store: nil, open: { _ in false }, finish: {}, cancel: {})
      let syncOff = arguments.contains("-SystemGallerySyncOff")
      model.preview(
        page: SharedPage(url: URL(string: "https://en.wikipedia.org/wiki/Lisbon"), title: "Lisbon - Wikipedia", text: nil),
        snapshot: syncOff ? SystemSnapshot(isBrowseForMeAvailable: true) : WidgetExporter.snapshot(for: app)
      )
      if arguments.contains("-SystemGalleryConfirm"), let device = model.sendTargets.first {
        model.send(to: device)
      }
      return ShareSheetView(model: model)
    }

    private func tile<Content: View, Background: View>(
      _ size: SystemWidgetSize,
      @ViewBuilder content: () -> Content,
      @ViewBuilder background: () -> Background
    ) -> some View {
      let frame: CGSize =
        switch size {
        case .small: CGSize(width: 170, height: 170)
        case .medium: CGSize(width: 364, height: 170)
        case .large: CGSize(width: 364, height: 382)
        }
      return content()
        .padding(Spacing.page)
        .frame(width: frame.width, height: frame.height)
        .background { background() }
        .clipShape(.rect(cornerRadius: 26, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
    }
  }
#endif

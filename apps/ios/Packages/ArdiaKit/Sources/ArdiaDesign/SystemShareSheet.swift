#if canImport(UIKit)
  import Foundation
  import Observation
  import SwiftUI

  @MainActor
  @Observable
  public final class ShareSheetModel {
    public enum Phase: Equatable {
      case loading
      case ready
      case done(String, succeeded: Bool)
    }

    public private(set) var phase: Phase = .loading
    public private(set) var page = SharedPage(url: nil, title: "", text: nil)
    public private(set) var snapshot: SystemSnapshot = .empty
    public private(set) var completions = 0
    public private(set) var failures = 0

    @ObservationIgnored private let store: SystemStore?
    @ObservationIgnored private let open: (URL) -> Bool
    @ObservationIgnored private let finish: () -> Void
    @ObservationIgnored public let cancel: () -> Void

    static let confirmationDelay: Duration = .seconds(1.4)

    public init(store: SystemStore?, open: @escaping (URL) -> Bool, finish: @escaping () -> Void, cancel: @escaping () -> Void) {
      self.store = store
      self.open = open
      self.finish = finish
      self.cancel = cancel
    }

    public func load(from context: NSExtensionContext?) async {
      snapshot = store?.loadSnapshot() ?? .empty
      page = await SharedPage.read(from: context)
      phase = .ready
    }

    public func preview(page: SharedPage, snapshot: SystemSnapshot) {
      self.page = page
      self.snapshot = snapshot
      phase = .ready
    }

    public var hasContent: Bool { page.url != nil || page.text != nil }

    public var offersBrowseForMe: Bool { snapshot.isBrowseForMeAvailable && !page.browseQuery.isEmpty }

    public var sendTargets: [SystemDevice] {
      guard snapshot.isSyncEnabled, page.url != nil else { return [] }
      return snapshot.sendTargets
    }

    public func openInArdia() {
      if let url = page.url {
        hand(SystemLink.open(url).url, fallback: SystemInboxItem(action: .open, url: url.absoluteString, title: page.title))
      } else if let text = page.text {
        hand(SystemLink.search(query: text, browseForMe: false).url, fallback: nil)
      }
    }

    public func browseForMe() {
      let query = page.browseQuery
      guard !query.isEmpty else { return }
      hand(
        SystemLink.search(query: query, browseForMe: true).url,
        fallback: SystemInboxItem(action: .browseForMe(query: query), url: page.url?.absoluteString, title: page.title)
      )
    }

    public func send(to device: SystemDevice) {
      guard let url = page.url else { return }
      let item = SystemInboxItem(action: .send(to: device), url: url.absoluteString, title: page.displayTitle)
      guard store?.enqueue(item) == true else {
        confirm(String(localized: "Couldn’t send this page. Open Ardia and try again."), succeeded: false)
        return
      }
      confirm(String(localized: "Sends to \(device.name) the next time Ardia syncs."))
    }

    private func hand(_ link: URL, fallback: SystemInboxItem?) {
      if open(link) {
        finish()
        return
      }
      if let fallback, store?.enqueue(fallback) == true {
        confirm(String(localized: "Opens the next time you open Ardia."))
      } else {
        confirm(String(localized: "Couldn’t open Ardia. Open it from the Home Screen to see this page."), succeeded: false)
      }
    }

    private func confirm(_ message: String, succeeded: Bool = true) {
      phase = .done(message, succeeded: succeeded)
      if succeeded { completions += 1 } else { failures += 1 }
      Task { [finish] in
        try? await Task.sleep(for: Self.confirmationDelay)
        finish()
      }
    }
  }


  public struct ShareSheetView: View {
    @Bindable var model: ShareSheetModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(model: ShareSheetModel) {
      self.model = model
    }

    @State private var isPresented = false

    public var body: some View {
      ZStack(alignment: .bottom) {
        SharePalette.scrim
          .opacity(isPresented ? 1 : 0)
          .ignoresSafeArea()
          .onTapGesture(perform: model.cancel)
          .accessibilityHidden(true)
        if isPresented {
          card
            .transition(reduceMotion ? .opacity : .move(edge: .bottom))
        }
      }
      .animation(Motion.snappy, value: model.phase)
      .sensoryFeedback(.success, trigger: model.completions)
      .sensoryFeedback(.error, trigger: model.failures)
      .onAppear {
        withAnimation(reduceMotion ? .easeOut(duration: 0.2) : Motion.smooth) { isPresented = true }
      }
    }

    private var card: some View {
      ViewThatFits(in: .vertical) {
        content
        ScrollView { content }
          .scrollBounceBehavior(.basedOnSize)
      }
      .frame(maxWidth: .infinity)
      .background {
        UnevenRoundedRectangle(topLeadingRadius: Radius.sheet, topTrailingRadius: Radius.sheet, style: .continuous)
          .fill(SharePalette.background)
          .ignoresSafeArea(edges: .bottom)
      }
      .padding(.top, Spacing.section * 2)
    }

    private var content: some View {
      VStack(alignment: .leading, spacing: Spacing.medium) {
        header
        switch model.phase {
        case .loading:
          ProgressView()
            .frame(maxWidth: .infinity, minHeight: 120)
        case .ready:
          if model.hasContent { actions } else { nothingToShare }
        case .done(let message, let succeeded):
          confirmation(message, succeeded: succeeded)
            .transition(reduceMotion ? .opacity : .scale(scale: 0.92).combined(with: .opacity))
        }
      }
      .padding(.horizontal, Spacing.page)
      .padding(.vertical, Spacing.medium)
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var header: some View {
      HStack(alignment: .top, spacing: Spacing.small) {
        let layout = typeSize.isAccessibilitySize
          ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.tight))
          : AnyLayout(HStackLayout(alignment: .center, spacing: Spacing.small))
        layout {
          ArdiaLogoMark()
            .frame(width: 40, height: 32)
          VStack(alignment: .leading, spacing: 2) {
            Text(model.page.displayTitle.isEmpty ? String(localized: "Ardia") : model.page.displayTitle)
              .font(.headline)
              .foregroundStyle(BrowsePalette.foregroundPrimary)
              .lineLimit(typeSize.isAccessibilitySize ? 4 : 2)
            if let host = model.page.url.flatMap({ SystemTab(title: "", url: $0.absoluteString).host }) {
              Text(host)
                .font(.subheadline)
                .foregroundStyle(BrowsePalette.foregroundSecondary)
                .lineLimit(1)
            }
          }
        }
        Spacer(minLength: 0)
        Button(action: model.cancel) {
          Image(systemName: "xmark")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(BrowsePalette.foregroundSecondary)
            .frame(width: 30, height: 30)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel("Close")
      }
    }

    private var actions: some View {
      VStack(alignment: .leading, spacing: Spacing.medium) {
        ShareActionGroup {
          ShareActionRow(
            title: model.page.url == nil ? Text("Search in Ardia") : Text("Open in Ardia"),
            subtitle: nil,
            symbol: model.page.url == nil ? "magnifyingglass" : "arrow.up.forward.app",
            action: model.openInArdia
          )
          if model.offersBrowseForMe {
            Divider().padding(.leading, ShareActionRow.dividerInset)
            ShareActionRow(
              title: Text("Browse for Me"),
              subtitle: model.page.url == nil ? Text("Get an answer from the web.") : Text("Get an answer about this page."),
              symbol: "sparkle.magnifyingglass",
              action: model.browseForMe
            )
          }
        }
        if !model.sendTargets.isEmpty {
          VStack(alignment: .leading, spacing: Spacing.tight) {
            (model.sendTargets.allSatisfy { $0.kind == .mac } ? Text("Send to Your Mac") : Text("Send to Your Devices"))
              .font(.footnote.weight(.semibold))
              .foregroundStyle(BrowsePalette.foregroundSecondary)
              .padding(.leading, Spacing.page)
            ShareActionGroup {
              ForEach(Array(model.sendTargets.enumerated()), id: \.element.id) { index, device in
                if index > 0 { Divider().padding(.leading, ShareActionRow.dividerInset) }
                ShareActionRow(title: Text(verbatim: device.name), subtitle: nil, symbol: device.symbol) {
                  model.send(to: device)
                }
              }
            }
          }
        } else if model.page.url != nil, !model.snapshot.isSyncEnabled {
          Text("To send pages to your Mac, turn on Sync With Your Mac in Ardia’s Settings.")
            .font(.footnote)
            .foregroundStyle(BrowsePalette.foregroundSecondary)
            .padding(.horizontal, Spacing.page)
        }
      }
    }

    private var nothingToShare: some View {
      Text("There’s no web page or text to share with Ardia.")
        .font(.body)
        .foregroundStyle(BrowsePalette.foregroundSecondary)
        .frame(maxWidth: .infinity, minHeight: 120)
    }

    private func confirmation(_ message: String, succeeded: Bool) -> some View {
      VStack(spacing: Spacing.small) {
        Image(systemName: succeeded ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
          .font(.system(size: 44, weight: .semibold))
          .foregroundStyle(succeeded ? Palette.indigo : BrowsePalette.findError)
          .symbolEffect(.bounce, value: model.completions)
        Text(message)
          .font(.headline)
          .multilineTextAlignment(.center)
          .foregroundStyle(BrowsePalette.foregroundPrimary)
      }
      .frame(maxWidth: .infinity, minHeight: 160)
    }
  }

  enum SharePalette {
    static let background = Color.adaptive(light: Color(hex: 0xF2F2F7), dark: Color(hex: 0x1C1C1E))
    static let group = Color.adaptive(light: .white, dark: Color(hex: 0x2C2C2E))
    static let scrim = Color.black.opacity(0.32)
    static let tile = Palette.indigo
  }

  struct ShareActionGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
      VStack(spacing: 0) { content }
        .background(SharePalette.group, in: .rect(cornerRadius: Radius.card, style: .continuous))
    }
  }

  struct ShareActionRow: View {
    static let dividerInset = Spacing.page + 30 + Spacing.small
    static let largestTile: CGFloat = 44

    let title: Text
    let subtitle: Text?
    let symbol: String
    let action: () -> Void

    @ScaledMetric(relativeTo: .body) private var tileSide: CGFloat = 30

    var body: some View {
      Button(action: action) {
        HStack(spacing: Spacing.small) {
          Image(systemName: symbol)
            .font(.system(size: min(tileSide, Self.largestTile) / 2, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: min(tileSide, Self.largestTile), height: min(tileSide, Self.largestTile))
            .background(SharePalette.tile, in: .rect(cornerRadius: 8, style: .continuous))
          VStack(alignment: .leading, spacing: 1) {
            title
              .font(.body)
              .foregroundStyle(BrowsePalette.foregroundPrimary)
            if let subtitle {
              subtitle
                .font(.footnote)
                .foregroundStyle(BrowsePalette.foregroundSecondary)
            }
          }
          Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.page)
        .padding(.vertical, Spacing.small)
        .frame(minHeight: 56)
        .contentShape(.rect)
      }
      .buttonStyle(ShareRowButtonStyle())
    }
  }

  struct ShareRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
      configuration.label
        .background(configuration.isPressed ? SystemPalette.rowPressed : .clear)
    }
  }

  #Preview("Page") {
    let model = ShareSheetModel(store: nil, open: { _ in false }, finish: {}, cancel: {})
    model.preview(
      page: SharedPage(url: URL(string: "https://en.wikipedia.org/wiki/Lisbon"), title: "Lisbon - Wikipedia", text: nil),
      snapshot: .preview
    )
    return ShareSheetView(model: model)
  }

  #Preview("Sync Off") {
    let model = ShareSheetModel(store: nil, open: { _ in false }, finish: {}, cancel: {})
    model.preview(
      page: SharedPage(url: URL(string: "https://www.swift.org/"), title: "Swift.org", text: nil),
      snapshot: .empty
    )
    return ShareSheetView(model: model)
  }
#endif

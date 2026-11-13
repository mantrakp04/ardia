import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageMenuHeader: View {
  let tabID: UUID
  let close: (@escaping () -> Void) -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  private var tab: BrowserTab? { app.tabs.tab(tabID) }
  private var page: WebTab? { app.web.existingWebTab(tabID) }
  private var isWebPage: Bool { tab.map { BrowserURL.isSyncable($0.url) } ?? false }

  var body: some View {
    let isLarge = dynamicTypeSize.isAccessibilitySize
    GlassBar {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 0) {
          button("chevron.backward", label: "Back", enabled: page?.canGoBack ?? false) {
            page?.goBack()
            close {}
          }
          button("chevron.forward", label: "Forward", enabled: page?.canGoForward ?? false) {
            page?.goForward()
            close {}
          }
          if isLarge {
            Spacer(minLength: 0)
          } else {
            titleLabel.lineLimit(1)
          }
          pinButton
          reloadButton
        }
        .frame(minHeight: GlassMetrics.hitTarget)
        if isLarge {
          Rectangle()
            .fill(Tokens.Role.divider)
            .frame(height: Tokens.Hairline.panel)
            .padding(.horizontal, Tokens.Space.xl)
          titleLabel
            .lineLimit(3)
            .padding(.horizontal, Tokens.Space.m)
            .padding(.vertical, Tokens.Space.l)
        }
      }
      .padding(.horizontal, Tokens.Space.xs)
      .glassControl(isLarge ? .tile : .capsule)
    }
  }

  private var pinButton: some View {
    let isPinned = tab.map(app.isPinnedToMac) ?? false
    return button(isPinned ? "star.fill" : "star", label: isPinned ? "Pinned to Mac" : "Pin to Mac", enabled: isWebPage && tab?.isPrivate == false) {
      app.pinCurrentToMac()
    }
    .contentTransition(.symbolEffect(.replace))
    .sensoryFeedback(.success, trigger: isPinned) { _, pinned in pinned }
  }

  @ViewBuilder
  private var reloadButton: some View {
    if page?.isLoading == true {
      button("xmark", label: "Stop", enabled: true) { page?.stopLoading() }
    } else {
      button("arrow.clockwise", label: "Reload", enabled: isWebPage) {
        page?.reload()
        close {}
      }
    }
  }

  private var titleLabel: some View {
    ZStack {
      if let feedback = app.browse.titleFeedback {
        Text(feedback)
          .fontWeight(Tokens.Weight.semibold)
          .foregroundStyle(Color.ardiaAccentText)
          .frame(maxWidth: .infinity)
          .transition(.opacity)
      } else {
        Text(titleText)
          .foregroundStyle(Tokens.Role.textPrimary)
          .frame(maxWidth: .infinity, alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .center)
          .transition(.opacity)
      }
    }
    .font(Typography.body)
    .padding(.horizontal, Tokens.Space.xs)
    .contentShape(.rect)
    .onTapGesture { editQuery() }
    .accessibilityAddTraits(.isButton)
    .accessibilityLabel(app.browse.titleFeedback ?? titleText)
    .accessibilityHint("Edits the search")
    .animation(.easeOut(duration: Tokens.Duration.base), value: app.browse.titleFeedback)
  }

  private var titleText: String {
    guard let tab else { return "" }
    let query = app.currentQuery(for: tab)
    if query != tab.url { return query }
    return tab.title.isEmpty ? (BrowserURL.host(of: tab.url) ?? tab.url) : tab.title
  }

  private func button(_ symbol: String, label: LocalizedStringKey, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(Typography.body.weight(Tokens.Weight.semibold))
        .frame(minWidth: GlassMetrics.hitTarget, minHeight: GlassMetrics.hitTarget)
        .padding(.horizontal, dynamicTypeSize.isAccessibilitySize ? Tokens.Space.xs : 0)
        .contentShape(.rect)
    }
    .buttonStyle(PressableStyle())
    .foregroundStyle(enabled ? AnyShapeStyle(Tokens.Role.textPrimary) : AnyShapeStyle(Tokens.Role.textTertiary))
    .disabled(!enabled)
    .accessibilityLabel(label)
    .help(label)
  }

  private func editQuery() {
    guard let tab else { return }
    let text = app.currentQuery(for: tab)
    close {}
    app.browse.presentSearch(from: .page, text: text, selectsAll: true)
  }
}

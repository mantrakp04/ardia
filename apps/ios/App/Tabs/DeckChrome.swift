import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI

struct DeckHeader: View {
  let privateCount: Int
  let canClose: Bool
  var showsMore = true
  let closeIncognito: () -> Void
  let closeAll: () -> Void

  @Environment(AppModel.self) private var app
  @State private var swipeTicks = 0

  private static let swipeThreshold: CGFloat = 40

  var body: some View {
    HStack(spacing: Tokens.Space.m) {
      if app.currentSpace != nil {
        SpaceHeader()
      } else {
        Text("Tabs")
          .typography(.title)
          .foregroundStyle(TabsPalette.headerText)
          .accessibilityAddTraits(.isHeader)
      }
      Spacer(minLength: Tokens.Space.m)
      if privateCount > 0 {
        IncognitoChip(count: privateCount, close: closeIncognito)
      }
      if showsMore {
        DeckMoreMenu(canClose: canClose, closeAll: closeAll)
      }
    }
    .frame(height: TabsLayout.deckHeaderHeight)
    .contentShape(.rect)
    .gesture(swipe)
    .sensoryFeedback(.selection, trigger: swipeTicks)
  }

  private var swipe: some Gesture {
    DragGesture(minimumDistance: 16)
      .onEnded { value in
        let dx = value.translation.width
        guard abs(dx) > Self.swipeThreshold, abs(dx) > abs(value.translation.height) * 1.5 else { return }
        let spaces = app.spaces
        guard let index = spaces.firstIndex(where: { $0.syncId == app.currentSpace?.syncId }) else { return }
        let target = index + (dx < 0 ? 1 : -1)
        guard spaces.indices.contains(target) else { return }
        swipeTicks += 1
        withAnimation(Tokens.Spring.snappy.animation) { app.selectSpace(spaces[target].syncId) }
      }
  }
}

struct ArchiveBanner: View {
  @Binding var interval: AutoArchiveInterval
  let answer: () -> Void

  var body: some View {
    HStack(spacing: Tokens.Space.m) {
      Text("Archive inactive tabs")
        .font(Typography.caption.weight(Tokens.Weight.medium))
        .foregroundStyle(Tokens.Role.textPrimary)
        .lineLimit(1)
        .minimumScaleFactor(0.85)
        .layoutPriority(1)
      Spacer(minLength: Tokens.Space.xs)
      Menu {
        Picker("Archive Inactive Tabs", selection: choice) {
          ForEach(AutoArchiveInterval.allCases) { option in
            Text(option.title).tag(option)
          }
        }
      } label: {
        HStack(spacing: Tokens.Space.xxs) {
          Text(interval.title)
            .lineLimit(1)
          Image(systemName: "chevron.up.chevron.down")
            .font(Typography.badge)
        }
        .font(Typography.caption.weight(Tokens.Weight.semibold))
        .foregroundStyle(Tokens.Role.accent)
        .frame(minHeight: GlassMetrics.hitTarget)
        .contentShape(.rect)
      }
      .menuOrder(.fixed)
      Button(action: answer) {
        Image(systemName: "xmark")
          .font(Typography.badge.weight(Tokens.Weight.bold))
          .foregroundStyle(.secondary)
          .frame(width: GlassMetrics.hitTarget, height: GlassMetrics.hitTarget)
          .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Keep This Setting")
    }
    .padding(.leading, Tokens.Space.xl)
    .frame(height: TabsLayout.bannerHeight)
    .glassPanel(.capsule)
    .accessibilityElement(children: .contain)
  }

  private var choice: Binding<AutoArchiveInterval> {
    Binding(
      get: { interval },
      set: { picked in
        interval = picked
        answer()
      }
    )
  }
}

struct DeckMoreMenu: View {
  let canClose: Bool
  let closeAll: () -> Void
  var size = GlassMetrics.hitTarget
  var morphID: String?

  @Environment(AppModel.self) private var app

  var body: some View {
    Menu {
      Button("Archive", systemImage: "archivebox") { app.openArchive() }
      if app.tabs.canReopenClosed {
        Button("Reopen Closed Tab", systemImage: "arrow.uturn.backward") { app.reopenLastClosed() }
      }
      Button("Settings", systemImage: "gearshape") { app.sheet = .settings }
      if canClose {
        Divider()
        Button("Close All Tabs", systemImage: "xmark", role: .destructive, action: closeAll)
      }
    } label: {
      Image(systemName: "ellipsis")
        .font(Typography.body.weight(Tokens.Weight.semibold))
        .foregroundStyle(Tokens.Role.textPrimary)
        .frame(width: size, height: size)
        .contentShape(.circle)
        .glassControl(.circle, morphID: morphID)
    }
    .accessibilityLabel("More")
  }
}

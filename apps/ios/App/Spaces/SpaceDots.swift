import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SpaceDots: View {
  var drawsBand = true

  @Environment(AppModel.self) private var app
  @Environment(\.interfaceStyle) private var interfaceStyle
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @State private var ticks = 0

  private static let dotSize: CGFloat = 7
  private static let slotWidth: CGFloat = 28
  private static let swipeThreshold: CGFloat = 24

  var body: some View {
    let spaces = app.spaces
    if spaces.count > 1 {
      let current = app.currentSpace?.syncId
      let showsIcons = app.showsSpaceIcons
      ViewThatFits(in: .horizontal) {
        row(spaces: spaces, current: current, showsIcons: showsIcons)
        ScrollView(.horizontal) {
          row(spaces: spaces, current: current, showsIcons: showsIcons)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
      }
      .foregroundStyle(.primary)
      .contentShape(.rect)
      .gesture(swipe(spaces: spaces, current: current))
      .sensoryFeedback(.selection, trigger: ticks)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(String(localized: "Spaces"))
      .accessibilityAdjustableAction { direction in
        switch direction {
        case .increment: step(1, spaces: spaces, current: current)
        case .decrement: step(-1, spaces: spaces, current: current)
        @unknown default: break
        }
      }
    }
  }

  private var showsBand: Bool {
    drawsBand && interfaceStyle.resolved(reduceTransparency: reduceTransparency) == .glass
  }

  private func row(spaces: [SyncedProfile], current: String?, showsIcons: Bool) -> some View {
    let banded = showsBand
    let cell = banded ? SpaceSwitcherMetrics.cell(showsIcon: showsIcons) : (showsIcons ? GlassMetrics.hitTarget : Self.slotWidth)
    return HStack(spacing: 0) {
      ForEach(spaces) { profile in
        let isCurrent = profile.syncId == current
        Button {
          select(profile.syncId)
        } label: {
          mark(for: profile, showsIcon: showsIcons)
            .opacity(isCurrent ? 1 : Tokens.Opacity.disabled)
            .frame(width: cell, height: GlassMetrics.hitTarget)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(profile.name)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
      }
    }
    .padding(.horizontal, banded ? SpaceSwitcherMetrics.endPadding(beside: cell) : 0)
    .background {
      if banded {
        Color.clear
          .frame(height: SpaceSwitcherMetrics.bandHeight)
          .glassBand(.capsule)
      }
    }
  }

  @ViewBuilder
  private func mark(for profile: SyncedProfile, showsIcon: Bool) -> some View {
    if showsIcon {
      SpaceBadge(icon: profile.badge, size: SidebarMetrics.Row.icon)
    } else {
      Circle().frame(width: Self.dotSize, height: Self.dotSize)
    }
  }

  private func swipe(spaces: [SyncedProfile], current: String?) -> some Gesture {
    DragGesture(minimumDistance: 12)
      .onEnded { value in
        let dx = value.translation.width
        guard abs(dx) > Self.swipeThreshold, abs(dx) > abs(value.translation.height) else { return }
        step(dx < 0 ? 1 : -1, spaces: spaces, current: current)
      }
  }

  private func step(_ delta: Int, spaces: [SyncedProfile], current: String?) {
    guard let index = spaces.firstIndex(where: { $0.syncId == current }), spaces.indices.contains(index + delta) else { return }
    select(spaces[index + delta].syncId)
  }

  private func select(_ syncId: String) {
    guard syncId != app.currentSpace?.syncId else { return }
    ticks += 1
    withAnimation(Tokens.Spring.snappy.animation) { app.selectSpace(syncId) }
  }
}

import ArdiaDesign
import ArdiaSync
import SwiftUI

struct SpaceHeader: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    if let space = app.currentSpace {
      let spaces = app.spaces
      if spaces.count > 1 {
        Menu {
          Picker(String(localized: "Space"), selection: selection) {
            ForEach(spaces) { profile in
              SpaceMenuLabel(space: profile).tag(profile.syncId)
            }
          }
        } label: {
          SpaceTitle(space: space, showsChevron: true)
        }
        .menuOrder(.fixed)
        .accessibilityLabel(String(localized: "Space, \(space.name)"))
        .accessibilityHint(String(localized: "Switches space."))
      } else {
        SpaceTitle(space: space, showsChevron: false)
          .accessibilityElement(children: .combine)
          .accessibilityAddTraits(.isHeader)
      }
    }
  }

  private var selection: Binding<String> {
    Binding(
      get: { app.currentSpace?.syncId ?? "" },
      set: { app.selectSpace($0) }
    )
  }
}

private struct SpaceTitle: View {
  let space: SyncedProfile
  let showsChevron: Bool

  var body: some View {
    HStack(spacing: Tokens.Space.m) {
      SpaceBadge(icon: space.badge)
      Text(space.name)
        .typography(.title)
        .lineLimit(1)
        .contentTransition(.opacity)
      if showsChevron {
        Image(systemName: "chevron.down")
          .font(Typography.caption.weight(Tokens.Weight.semibold))
          .foregroundStyle(.secondary)
      }
    }
    .foregroundStyle(Tokens.Role.textPrimary)
    .frame(minHeight: GlassMetrics.hitTarget)
    .contentShape(.rect)
  }
}

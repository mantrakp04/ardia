import SwiftUI

public struct GlassGallery: View {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.profileLook) private var look
  @Environment(\.interfaceStyle) private var style

  public init() {}

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: Tokens.Space.xxl) {
        VStack(alignment: .leading, spacing: Tokens.Space.xs) {
          Text("Glass kit").typography(.largeTitle)
          Text(caption).typography(.caption).foregroundStyle(Tokens.Role.textSecondary)
        }
        section("Bar") { bar }
        section("States") { states }
        section("Tiles") { tiles }
        section("Blending") { blending }
        section("Panel") { panel }
        section("Toast") { toast }
        section("Buttons") { buttons }
      }
      .foregroundStyle(Tokens.Role.textPrimary)
      .padding(Tokens.Space.xxl)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background { backdrop.ignoresSafeArea() }
  }

  private var caption: String {
    "\(style.rawValue.capitalized), \(colorScheme == .dark ? "dark" : "light")"
  }

  private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: Tokens.Space.m) {
      Text(title).typography(.section).foregroundStyle(Tokens.Role.textSecondary)
      content()
    }
  }

  private var bar: some View {
    GlassBar {
      HStack(spacing: Tokens.Space.m) {
        symbol("square.on.square").glassControl(.circle, morphID: "tabs")
        HStack(spacing: Tokens.Space.s) {
          Image(systemName: "lock.fill").font(Typography.caption)
          Text("wikipedia.org").typography(.field)
          Spacer(minLength: Tokens.Space.m)
          Image(systemName: "ellipsis")
        }
        .padding(.horizontal, Tokens.Space.xl)
        .frame(height: GalleryMetrics.control)
        .glassControl(.capsule, morphID: "address")
        symbol("plus").glassControl(.circle, morphID: "plus")
      }
    }
  }

  private var states: some View {
    HStack(spacing: Tokens.Space.xl) {
      ForEach(GlassState.allCases, id: \.self) { state in
        VStack(spacing: Tokens.Space.s) {
          symbol("star.fill").glassControl(.circle, state: state)
          Text(state.rawValue).typography(.caption).foregroundStyle(Tokens.Role.textSecondary)
        }
      }
    }
  }

  private var tiles: some View {
    GlassBar {
      HStack(spacing: SidebarMetrics.Tile.gap) {
        ForEach(Array(GalleryMetrics.tileSymbols.enumerated()), id: \.offset) { index, name in
          Image(systemName: name)
            .frame(width: SidebarMetrics.Tile.minWidth, height: SidebarMetrics.Tile.height)
            .glassControl(.tile, state: index == 1 ? .active : .rest)
        }
      }
    }
  }

  private var blending: some View {
    GlassBar {
      HStack(spacing: Tokens.Space.xxs) {
        symbol("chevron.left").glassControl(.circle)
        symbol("chevron.right").glassControl(.circle)
      }
    }
  }

  private var panel: some View {
    VStack(alignment: .leading, spacing: Tokens.Space.l) {
      Label("Copy Link", systemImage: "link")
      Label("Share", systemImage: "square.and.arrow.up")
      Divider().overlay(Tokens.Role.divider)
      Label("Find on Page", systemImage: "magnifyingglass")
    }
    .typography(.row)
    .padding(Tokens.Space.xl)
    .frame(width: SidebarMetrics.defaultWidth, alignment: .leading)
    .glassPanel(.rounded)
  }

  private var toast: some View {
    Label("Link copied", systemImage: "checkmark.circle.fill")
      .typography(.row)
      .padding(.horizontal, Tokens.Space.xl)
      .frame(height: GalleryMetrics.control)
      .glassPanel(.capsule)
  }

  private var buttons: some View {
    HStack(spacing: Tokens.Space.l) {
      Button {} label: { Image(systemName: "square.and.arrow.up") }
        .buttonStyle(.glassAction)
      Button("Open") {}
        .buttonStyle(.glassPrimaryAction)
      Button {} label: { Image(systemName: "xmark") }
        .buttonStyle(.glassControl(.circle))
    }
  }

  private func symbol(_ name: String) -> some View {
    Image(systemName: name)
      .frame(width: GalleryMetrics.control, height: GalleryMetrics.control)
  }

  private var backdrop: some View {
    LinearGradient(colors: look.windowTint(dark: colorScheme == .dark), startPoint: .top, endPoint: .bottom)
      .overlay {
        HStack(spacing: Tokens.Space.xxxl) {
          ForEach(Array(GalleryMetrics.stripes.enumerated()), id: \.offset) { _, role in
            Rectangle().fill(role).frame(width: Tokens.Space.xl)
          }
        }
      }
  }
}

private enum GalleryMetrics {
  static let control = BrowseLayout.hitTarget
  static let tileSymbols = ["globe", "envelope.fill", "calendar", "music.note"]
  static let stripes = [Tokens.Role.accent, Tokens.Role.destructive, Tokens.Role.warning, Tokens.Role.success, Tokens.Role.formAccent, Tokens.Role.textPrimary]
}

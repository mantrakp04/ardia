import ArdiaDesign
import SwiftUI

struct SettingsRowLabel: View {
  var title: LocalizedStringKey
  var systemImage: String
  var tint: Color

  init(_ title: LocalizedStringKey, systemImage: String, tint: Color) {
    self.title = title
    self.systemImage = systemImage
    self.tint = tint
  }

  var body: some View {
    Label {
      Text(title)
    } icon: {
      SettingsIconTile(systemImage: systemImage, color: tint)
    }
  }
}

struct SettingsHero<Accessory: View>: View {
  var title: LocalizedStringKey
  var subtitle: Text
  var systemImage: String
  var tint: Color
  var accessory: Accessory

  init(_ title: LocalizedStringKey, subtitle: Text, systemImage: String, tint: Color, @ViewBuilder accessory: () -> Accessory) {
    self.title = title
    self.subtitle = subtitle
    self.systemImage = systemImage
    self.tint = tint
    self.accessory = accessory()
  }

  var body: some View {
    Section {
      VStack(spacing: Tokens.Space.l) {
        SettingsIconTile(systemImage: systemImage, color: tint, baseSide: SettingsTile.heroSide)
        VStack(spacing: Tokens.Space.xs) {
          Text(title)
            .font(Typography.largeTitle)
            .multilineTextAlignment(.center)
            .accessibilityAddTraits(.isHeader)
          subtitle
            .font(Typography.row)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .contentTransition(.opacity)
        }
        accessory
      }
      .frame(maxWidth: .infinity)
      .padding(.bottom, Tokens.Space.xs)
      .listRowBackground(Color.clear)
      .listRowInsets(EdgeInsets(top: 0, leading: Tokens.Space.xl, bottom: 0, trailing: Tokens.Space.xl))
    }
  }
}

extension SettingsHero where Accessory == EmptyView {
  init(_ title: LocalizedStringKey, subtitle: Text, systemImage: String, tint: Color) {
    self.init(title, subtitle: subtitle, systemImage: systemImage, tint: tint) { EmptyView() }
  }
}

struct LegibleInk: ShapeStyle {
  var tint: Color

  func resolve(in environment: EnvironmentValues) -> Color {
    let cell = Color(.secondarySystemGroupedBackground).resolve(in: environment)
    let backdrop = environment.lookBackdropScheme.map { environment.profileLook.surfaceColors(dark: $0 == .dark) } ?? []
    let surfaces = [TokenColor(cell)] + backdrop
    return LegibleTint.ink(
      TokenColor(tint.resolve(in: environment)),
      on: surfaces,
      dark: environment.colorScheme == .dark,
      increasedContrast: environment.colorSchemeContrast == .increased
    ).color
  }
}

extension ShapeStyle where Self == LegibleInk {
  static func ink(_ tint: Color) -> LegibleInk { LegibleInk(tint: tint) }
}

nonisolated extension TokenColor {
  init(_ resolved: Color.Resolved) {
    self.init(
      red: Double(min(max(resolved.red, 0), 1)),
      green: Double(min(max(resolved.green, 0), 1)),
      blue: Double(min(max(resolved.blue, 0), 1))
    )
  }
}

extension View {
  func settingsPage(_ title: LocalizedStringKey) -> some View {
    modifier(SettingsPageTitle(title: title))
  }

  func settingsChrome() -> some View {
    modifier(SettingsChrome())
  }
}

private struct SettingsChrome: ViewModifier {
  @State private var page = PageBox()

  func body(content: Content) -> some View {
    content
      .contentMargins(.leading, SettingsLayout.contentMargin(forWidth: page.width, safeInset: page.leading), for: .scrollContent)
      .contentMargins(.trailing, SettingsLayout.contentMargin(forWidth: page.width, safeInset: page.trailing), for: .scrollContent)
      .background { PageBoxProbe(page: $page) }
      .lookInk()
      .lookBackdrop()
      .scrollEdgeEffectStyle(.soft, for: .top)
  }
}

nonisolated private struct PageBox: Equatable, Sendable {
  var width: CGFloat = 0
  var leading: CGFloat = 0
  var trailing: CGFloat = 0
}

private struct PageBoxProbe: View {
  @Binding var page: PageBox

  var body: some View {
    Color.clear
      .ignoresSafeArea()
      .onGeometryChange(for: PageBox.self) { proxy in
        PageBox(width: proxy.size.width, leading: proxy.safeAreaInsets.leading, trailing: proxy.safeAreaInsets.trailing)
      } action: { measured in
        page = measured
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

private struct SettingsPageTitle: ViewModifier {
  var title: LocalizedStringKey
  @State private var isHeroHidden = false

  func body(content: Content) -> some View {
    content
      .navigationTitle(isHeroHidden ? title : "")
      .navigationBarTitleDisplayMode(.inline)
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.contentInsets.top > SettingsLayout.heroScrollThreshold
      } action: { _, hidden in
        isHeroHidden = hidden
      }
  }
}

struct SetupStepRow<Content: View>: View {
  enum Progress: Equatable { case done, current, upcoming }

  var number: Int
  var title: Text
  var detail: Text
  var progress: Progress
  var content: Content

  @ScaledMetric(relativeTo: .body) private var badge: CGFloat = 26

  init(_ number: Int, title: Text, detail: Text, progress: Progress, @ViewBuilder content: () -> Content) {
    self.number = number
    self.title = title
    self.detail = detail
    self.progress = progress
    self.content = content()
  }

  var body: some View {
    HStack(alignment: .top, spacing: Tokens.Space.l) {
      ZStack {
        Circle().fill(badgeFill)
        if progress == .done {
          Image(systemName: "checkmark")
            .font(Typography.badge.weight(.bold))
            .foregroundStyle(.white)
            .transition(.scale.combined(with: .opacity))
        } else {
          Text(number.formatted())
            .font(Typography.row.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(progress == .current ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary))
        }
      }
      .frame(width: badge, height: badge)
      .animation(Motion.snappy, value: progress)
      .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: Tokens.Space.xs) {
        title
          .font(Typography.title)
          .foregroundStyle(progress == .upcoming ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
        detail
          .font(Typography.row)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        content
          .padding(.top, Tokens.Space.xs)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, Tokens.Space.xs)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(accessibilityTitle)
  }

  private var badgeFill: AnyShapeStyle {
    switch progress {
    case .done: AnyShapeStyle(Color.green)
    case .current: AnyShapeStyle(Palette.formAccent)
    case .upcoming: AnyShapeStyle(.fill.tertiary)
    }
  }

  private var accessibilityTitle: Text {
    switch progress {
    case .done: Text("Step \(number), done")
    case .current: Text("Step \(number)")
    case .upcoming: Text("Step \(number), later")
    }
  }
}

extension SetupStepRow.Progress {
  static func step(done: Bool, after previous: Bool) -> Self {
    done ? .done : (previous ? .current : .upcoming)
  }
}

extension Color {
  static let ardiaAccentText = Palette.formAccent
  static let ardiaTitle = Color.primary
}

struct AppIconPreview: View {
  static let cornerShare: CGFloat = 0.225

  var side: CGFloat = 29
  @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

  private var scaledSide: CGFloat { side * min(scale, 1.4) }

  var body: some View {
    Image("AppIconPreview")
      .resizable()
      .interpolation(.high)
      .frame(width: scaledSide, height: scaledSide)
      .clipShape(.rect(cornerRadius: scaledSide * Self.cornerShare, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: scaledSide * Self.cornerShare, style: .continuous)
          .strokeBorder(.primary.opacity(0.08), lineWidth: 0.5)
      }
      .accessibilityHidden(true)
  }
}

struct SettingsSwitchStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Toggle(configuration)
      .toggleStyle(.switch)
      .tint(Color(.systemGreen))
  }
}

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
      VStack(spacing: Spacing.small) {
        SettingsIconTile(systemImage: systemImage, color: tint, baseSide: 64)
        VStack(spacing: Spacing.hairline) {
          Text(title)
            .font(.title2.bold())
            .multilineTextAlignment(.center)
            .accessibilityAddTraits(.isHeader)
          subtitle
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .contentTransition(.opacity)
        }
        accessory
      }
      .frame(maxWidth: .infinity)
      .padding(.bottom, Spacing.hairline)
      .listRowBackground(Color.clear)
      .listRowInsets(EdgeInsets(top: 0, leading: Spacing.page, bottom: 0, trailing: Spacing.page))
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
    let isDark = environment.colorScheme == .dark
    let target: Float = environment.colorSchemeContrast == .increased ? 7 : 4.5
    let surface = isDark
      ? Color.Resolved(red: 0.110, green: 0.110, blue: 0.118)
      : Color.Resolved(red: 0.949, green: 0.949, blue: 0.969)
    let destination = isDark ? Color.Resolved(red: 1, green: 1, blue: 1) : Color.Resolved(red: 0, green: 0, blue: 0)
    let start = tint.resolve(in: environment)
    var candidate = start
    var amount: Float = 0
    while candidate.contrast(against: surface) < target && amount < 1 {
      amount = min(1, amount + 0.03)
      candidate = start.mixed(with: destination, by: amount)
    }
    return Color(candidate)
  }
}

extension ShapeStyle where Self == LegibleInk {
  static func ink(_ tint: Color) -> LegibleInk { LegibleInk(tint: tint) }
}

nonisolated extension Color.Resolved {
  func mixed(with other: Color.Resolved, by amount: Float) -> Color.Resolved {
    Color.Resolved(
      red: red + (other.red - red) * amount,
      green: green + (other.green - green) * amount,
      blue: blue + (other.blue - blue) * amount,
      opacity: opacity
    )
  }

  var relativeLuminance: Float {
    0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue
  }

  func contrast(against other: Color.Resolved) -> Float {
    let a = relativeLuminance
    let b = other.relativeLuminance
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)
  }
}

extension View {
  func settingsPage(_ title: LocalizedStringKey) -> some View {
    modifier(SettingsPageTitle(title: title))
  }

  func settingsChrome() -> some View {
    scrollEdgeEffectStyle(.hard, for: .top)
      .toolbarBackground(Color(.systemGroupedBackground), for: .navigationBar)
      .toolbarBackgroundVisibility(.visible, for: .navigationBar)
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
        geometry.contentOffset.y + geometry.contentInsets.top > 150
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
    HStack(alignment: .top, spacing: Spacing.small) {
      ZStack {
        Circle().fill(badgeFill)
        if progress == .done {
          Image(systemName: "checkmark")
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .transition(.scale.combined(with: .opacity))
        } else {
          Text(number.formatted())
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(progress == .current ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary))
        }
      }
      .frame(width: badge, height: badge)
      .animation(Motion.snappy, value: progress)
      .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: Spacing.hairline) {
        title
          .font(.body.weight(.semibold))
          .foregroundStyle(progress == .upcoming ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
        detail
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        content
          .padding(.top, Spacing.hairline)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, Spacing.hairline)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(accessibilityTitle)
  }

  private var badgeFill: AnyShapeStyle {
    switch progress {
    case .done: AnyShapeStyle(Color.green)
    case .current: AnyShapeStyle(Palette.indigo)
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
  static let ardiaAccentText = Color.adaptive(light: Palette.indigo, dark: Color(hex: 0x6F86FF))

  static let ardiaTitle = Color(uiColor: UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0xC9 / 255, green: 0xD3 / 255, blue: 0xFB / 255, alpha: 1)
      : UIColor(red: 0x29 / 255, green: 0x0A / 255, blue: 0x9E / 255, alpha: 1)
  })
}

struct AppIconPreview: View {
  var side: CGFloat = 29
  @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

  private var scaledSide: CGFloat { side * min(scale, 1.4) }

  var body: some View {
    Image("AppIconPreview")
      .resizable()
      .interpolation(.high)
      .frame(width: scaledSide, height: scaledSide)
      .clipShape(.rect(cornerRadius: scaledSide * 0.225, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: scaledSide * 0.225, style: .continuous)
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

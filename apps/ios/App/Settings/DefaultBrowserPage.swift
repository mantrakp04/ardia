import ArdiaDesign
import SwiftUI

struct DefaultBrowserPage: View {
  var body: some View {
    ScrollView {
      DefaultBrowserInstructions()
        .padding(.horizontal, Tokens.Space.xxl)
        .padding(.top, Tokens.Space.xxxl)
        .padding(.bottom, Tokens.Space.huge)
    }
    .navigationTitle("Default Browser")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct DefaultBrowserInstructions: View {
  var onLater: (() -> Void)?
  var onOpened: (() -> Void)?

  @Environment(AppModel.self) private var app
  @Environment(\.openURL) private var openURL
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    VStack(spacing: Tokens.Space.xxxl) {
      VStack(spacing: Tokens.Space.l) {
        Text("How to change your default browser")
          .typography(.display)
          .foregroundStyle(Color.ardiaTitle)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
        Text("Open links from other apps in Ardia.")
          .font(Typography.body)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }

      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: Tokens.Space.l) {
          Text("1. Open Ardia in Settings")
          Text("2. Tap on “Default Browser App”")
          Text("3. Select Ardia")
        }
        .font(Typography.body)
        .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        stepsCard
      }

      VStack(spacing: Tokens.Space.l) {
        Button {
          onOpened?()
          app.defaultBrowser.willOpenSystemSettings()
          if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
          Text("Open Ardia in Settings")
            .font(Typography.title)
            .frame(maxWidth: .infinity, minHeight: SettingsLayout.primaryButtonHeight)
        }
        .buttonStyle(.glassPrimaryAction)

        if let onLater {
          Button("Maybe Later", action: onLater)
            .font(Typography.title)
            .foregroundStyle(Color.ardiaTitle)
            .frame(minHeight: GlassMetrics.hitTarget)
        }
      }
    }
  }

  private var stepsCard: some View {
    VStack(spacing: 0) {
      DefaultBrowserStep(number: 1, text: Text("Open Ardia in Settings")) {
        Image(systemName: "gear")
          .font(Typography.title)
          .foregroundStyle(.white)
          .frame(width: SettingsTile.side, height: SettingsTile.side)
          .background(Color.gray.gradient, in: .rect(cornerRadius: Tokens.Radius.toolbar, style: .continuous))
      }
      Divider().padding(.leading, SettingsLayout.stepDividerInset)
      DefaultBrowserStep(number: 2, text: Text("Tap on “Default Browser App”")) {
        Image(systemName: "hand.point.up.left.fill")
          .font(Typography.title.weight(.regular))
          .foregroundStyle(.secondary)
          .frame(width: SettingsTile.side, height: SettingsTile.side)
      }
      Divider().padding(.leading, SettingsLayout.stepDividerInset)
      DefaultBrowserStep(number: 3, text: Text("Select Ardia")) {
        AppIconPreview()
      }
    }
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: Tokens.Radius.sheet, style: .continuous))
  }
}

private struct DefaultBrowserStep<Icon: View>: View {
  var number: Int
  var text: Text
  @ViewBuilder var icon: Icon

  var body: some View {
    HStack(spacing: Tokens.Space.xl) {
      icon
        .frame(minWidth: SettingsTile.side)
      Text("\(number.formatted()). \(text)")
    }
    .font(Typography.body)
    .frame(maxWidth: .infinity, minHeight: SettingsLayout.stepRowHeight, alignment: .leading)
    .padding(.horizontal, Tokens.Space.xl)
    .padding(.vertical, Tokens.Space.xs)
    .accessibilityElement(children: .combine)
  }
}

#Preview("Default Browser") {
  NavigationStack {
    DefaultBrowserPage()
  }
  .environment(AppModel(isDemo: true))
}
